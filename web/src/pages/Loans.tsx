/* Borrow — bot-operated lending, monitoring only. Nothing here places, repays,
   or adjusts a loan; the engine does all of that in the backend (gated +
   ledgered routes). The page tells the truth — debt, LTV, interest, history,
   the loanable universe — and carries exactly ONE control: the owner's Borrow
   Guard kill-switch. Anatomy: bwx hero + Binance ongoing-order stat grid,
   Markets-style screener. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect, pageList, Star } from '../components/PillSelect';
import { tokenName } from '../lib/tokenNames';
import { fmtPrice, fmtPct, fmtQty, timeAgo } from '../format';
import type { BorrowGuardConfig, LoansSnapshot } from '../types';
import './Markets.css';
import './Loans.css';

type LoanView = 'orders' | 'overview' | 'activity';
type SortKey = 'asset' | 'hourly' | 'apr' | 'max' | 'perp';
type AvailFilter = 'all' | 'basis';
type OngoingLoan = LoansSnapshot['ongoing'][number];
type LoanActivity = LoansSnapshot['activity'][number];

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

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

/** One row of the borrow screener: catalog truth + market context. */
interface BorrowRow {
  coin: string;
  hourly: number | null;
  apr: number | null;
  max: number | null;
  perp: boolean;
  symbol: string | null;
}

function fmtRate(v: number | null, digits = 4): string {
  if (!finite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function ltvPct(v: number | null | undefined, digits = 0): string {
  if (!finite(v)) return '—';
  return fmtPct(v * 100, digits, false);
}

function riskOf(ltv: number, callLTV: number, liqLTV: number): 'low' | 'call' | 'liq' {
  if (ltv >= liqLTV) return 'liq';
  if (ltv >= callLTV) return 'call';
  return 'low';
}

const RISK_LABEL = { low: 'Low Risk', call: 'Margin Call', liq: 'Liquidation' } as const;

function activityTone(kind: LoanActivity['kind']): 'ok' | 'warn' | 'idle' {
  if (kind === 'flex_repay' || kind === 'margin_repay') return 'ok';
  if (kind === 'flex_borrow' || kind === 'margin_borrow') return 'warn';
  return 'idle';
}

function activityTitle(e: LoanActivity): string {
  switch (e.kind) {
    case 'flex_borrow':
      return `Borrowed ${fmtQty(e.amount)} ${e.loanCoin}`;
    case 'flex_repay':
      return `Repaid ${fmtQty(e.amount)} ${e.loanCoin}`;
    case 'ltv_adjust':
      return `${e.detail?.startsWith('REDUCED') ? 'Removed' : 'Added'} ${fmtQty(e.amount)} ${e.collateralCoin ?? ''} Collateral`;
    case 'margin_borrow':
      return `Margin Borrowed ${fmtQty(e.amount)} ${e.loanCoin}`;
    case 'margin_repay':
      return `Margin Repaid ${fmtQty(e.amount)} ${e.loanCoin}`;
    case 'margin_interest':
      return `Margin Interest ${fmtQty(e.amount)} ${e.loanCoin}`;
  }
}

function activityDetail(e: LoanActivity): string {
  const parts = [
    e.kind.startsWith('flex') || e.kind === 'ltv_adjust' ? 'Flexible Loan' : 'Cross Margin',
    e.collateralCoin ? `Collateral ${e.collateralCoin}` : null,
    e.detail && !e.detail.includes('Flexible loan') ? e.detail : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return status
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Zone widths for the LTV meter: green to margin-call, amber to liquidation,
    red beyond — all on a scale that leaves the red zone visible. */
function meterZones(callLTV: number, liqLTV: number, currentLTV: number) {
  const max = Math.max(liqLTV * 1.15, currentLTV * 1.05, 0.0001);
  return {
    low: (callLTV / max) * 100,
    call: ((liqLTV - callLTV) / max) * 100,
    liq: ((max - liqLTV) / max) * 100,
    marker: Math.min(98.5, Math.max(1.5, (currentLTV / max) * 100)),
  };
}

export function Loans() {
  const { state, markets, openDetail, saveConfig, toggleWatch, prefs } = useStore();
  const [loans, setLoans] = useState<LoansSnapshot | null>(null);
  const [earnAprs, setEarnAprs] = useState<Map<string, number>>(new Map());
  const [loanView, setLoanView] = useState<LoanView>('orders');
  const [guardBusy, setGuardBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [avail, setAvail] = useState<AvailFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('hourly');
  const [sortDesc, setSortDesc] = useState(false);
  const [pageN, setPageN] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((n) => n + 1));

  useEffect(() => {
    let alive = true;
    void fetch('/api/loans')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setLoans(d as LoansSnapshot))
      .catch(() => undefined);
    void fetch('/api/earn')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const rows = (d as { rows?: { asset: string; apr: number }[] }).rows ?? [];
        setEarnAprs(new Map(rows.map((r) => [r.asset, r.apr * 100])));
      })
      .catch(() => undefined);
    const t = window.setInterval(() => setRefreshTick((n) => n + 1), Math.max(0.5, prefs.dataCadence?.account ?? 30) * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, [refreshTick, prefs.dataCadence?.account]);

  const priceOf = (asset: string): number | null =>
    asset === 'USDT' || asset === 'USDC' || asset === 'FDUSD'
      ? 1
      : markets.find((m) => m.symbol === `${asset}USDT`)?.spot ?? null;

  const perpBases = useMemo(() => new Set(markets.filter((m) => m.hasPerp).map((m) => m.base)), [markets]);
  const marketSymbols = useMemo(() => new Set(markets.map((m) => m.symbol)), [markets]);

  // ---- screener universe: the live loanable catalog ------------------------
  const rows = useMemo<BorrowRow[]>(() => {
    return (loans?.loanable ?? []).map((c) => ({
      coin: c.loanCoin,
      hourly: c.hourlyRatePct,
      apr: c.yearlyRatePct,
      max: c.maxLimit,
      perp: perpBases.has(c.loanCoin),
      symbol: marketSymbols.has(`${c.loanCoin}USDT`) ? `${c.loanCoin}USDT` : null,
    }));
  }, [loans?.loanable, perpBases, marketSymbols]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    let r = rows;
    if (avail === 'basis') r = r.filter((x) => x.perp);
    if (q) r = r.filter((x) => x.coin.includes(q) || tokenName(x.coin).toUpperCase().includes(q));
    const dir = sortDesc ? -1 : 1;
    const num = (v: number | null) => (finite(v) ? v : sortDesc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
    return [...r].sort((a, b) => {
      switch (sortKey) {
        case 'asset': return a.coin.localeCompare(b.coin) * dir;
        case 'hourly': return (num(a.hourly) - num(b.hourly)) * dir;
        case 'apr': return (num(a.apr) - num(b.apr)) * dir;
        case 'max': return (num(a.max) - num(b.max)) * dir;
        case 'perp': return ((a.perp ? 1 : 0) - (b.perp ? 1 : 0)) * -dir;
      }
    });
  }, [rows, search, avail, sortKey, sortDesc]);

  useEffect(() => setPageN(0), [search, avail, sortKey, sortDesc, pageSize]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(pageN, pages - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  // ---- posture numbers (all real) -------------------------------------------
  const margin = loans?.margin ?? null;
  const guard = state?.config.borrowGuard ?? DEFAULT_GUARD;
  const ongoing = loans?.ongoing ?? [];
  const watchlist = state?.config.watchlist ?? [];
  const marginDebts = (margin?.assets ?? []).filter((a) => a.borrowed > 0 || a.interest > 0);
  const flexDebtUsd = ongoing.reduce((s, o) => s + o.totalDebt * (priceOf(o.loanCoin) ?? 0), 0);
  const marginDebtUsd = marginDebts.reduce((s, a) => s + (a.borrowed + a.interest) * (priceOf(a.asset) ?? 0), 0);
  const totalDebtUsd = flexDebtUsd + marginDebtUsd;
  const collateralUsd = ongoing.reduce((sum, o) => sum + o.collateralAmount * (priceOf(o.collateralCoin) ?? 0), 0);
  const live = !!loans?.available && !loans?.error;
  const activity = loans?.activity ?? [];
  const loanBlocked = guard.newBorrowPaused || guard.repayOnly;
  const maxLoanLtv = ongoing.reduce((m, o) => Math.max(m, o.currentLTV), 0);
  const primaryLoan = ongoing[0] ?? null;
  const primaryApr = primaryLoan ? (loans?.loanable ?? []).find((c) => c.loanCoin === primaryLoan.loanCoin)?.yearlyRatePct ?? null : null;

  const collateralFor = (coin: string) => (loans?.collateral ?? []).find((c) => c.collateralCoin === coin) ?? null;
  const highestLtvLoan = ongoing.reduce<OngoingLoan | null>((highest, order) => (!highest || order.currentLTV > highest.currentLTV ? order : highest), null);
  const healthTerms = highestLtvLoan ? collateralFor(highestLtvLoan.collateralCoin) : null;
  const healthCallLtv = healthTerms?.marginCallLTV ?? 0.85;
  const healthLiqLtv = healthTerms?.liquidationLTV ?? 0.91;
  const healthInitialLtv = healthTerms?.initialLTV ?? 0.78;
  const healthRisk = highestLtvLoan ? riskOf(highestLtvLoan.currentLTV, healthCallLtv, healthLiqLtv) : null;
  const healthZones = highestLtvLoan ? meterZones(healthCallLtv, healthLiqLtv, highestLtvLoan.currentLTV) : null;
  const primaryCollateralApr = primaryLoan ? earnAprs.get(primaryLoan.collateralCoin) ?? null : null;
  const primaryNetApr = finite(primaryApr) ? primaryApr - (primaryCollateralApr ?? 0) : null;
  const activeCount = ongoing.length + marginDebts.length;
  const flexibleDebtShare = totalDebtUsd > 0 ? Math.max(0, Math.min(100, (flexDebtUsd / totalDebtUsd) * 100)) : 0;

  const toggleLoanBlock = async () => {
    if (guardBusy) return;
    setGuardBusy(true);
    try {
      const nextBlocked = !loanBlocked;
      await saveConfig({ borrowGuard: { ...guard, newBorrowPaused: nextBlocked, repayOnly: nextBlocked } });
    } finally {
      setGuardBusy(false);
    }
  };

  const assetTotals = (pick: (o: OngoingLoan) => { coin: string; qty: number }) => {
    const map = new Map<string, { coin: string; qty: number; usd: number; symbol: string | null }>();
    for (const o of ongoing) {
      const { coin, qty } = pick(o);
      const prev = map.get(coin) ?? { coin, qty: 0, usd: 0, symbol: marketSymbols.has(`${coin}USDT`) ? `${coin}USDT` : null };
      prev.qty += qty;
      prev.usd += qty * (priceOf(coin) ?? 0);
      map.set(coin, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.usd - a.usd);
  };
  const debtAssets = useMemo(
    () => assetTotals((o) => ({ coin: o.loanCoin, qty: o.totalDebt })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ongoing, markets, marketSymbols],
  );
  const collateralAssets = useMemo(
    () => assetTotals((o) => ({ coin: o.collateralCoin, qty: o.collateralAmount })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ongoing, markets, marketSymbols],
  );

  const SortHead = ({ label, k, right = true }: { label: string; k: SortKey; right?: boolean }) => (
    <th className={`${right ? 'r' : 'l'} ${sortKey === k ? 'sorted' : ''}`} aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button className="mkx-th" type="button" onClick={() => { if (sortKey === k) setSortDesc((v) => !v); else { setSortKey(k); setSortDesc(k !== 'asset' && k !== 'hourly' && k !== 'apr'); } }}>
        {label}
        <i className="bwx-sort-glyph">{sortKey === k ? (sortDesc ? '▾' : '▴') : ''}</i>
      </button>
    </th>
  );

  return (
    <div className="container page mkx bwx-page">
      {/* ---- Borrow header — the same calm hierarchy as Markets --------- */}
      <header className="mkx-hero bwx-hero">
        <div className="mkx-hero-text">
          <h1>Borrow</h1>
          <p className="mkx-index bwx-index">
            {loans
              ? activeCount > 0
                ? `${activeCount} Active ${activeCount === 1 ? 'Position' : 'Positions'} · ${fmtPrice(totalDebtUsd)} Total Debt`
                : 'No Active Borrow Positions'
              : 'Loading Account Loan State'}
            <span className={`mkx-live ${live ? 'on' : ''}`}>
              <i />
              {live ? `Catalog Live${loans?.fetchedAt ? ` · ${timeAgo(loans.fetchedAt)}` : ''}` : 'Catalog Loading'}
            </span>
          </p>
        </div>
        <div className="bwx-guard" aria-label="Borrow guard control">
          <span className="bwx-guard-copy">
            <b>Borrow Guard</b>
            <em className={loanBlocked ? 'blocked' : 'open'}>{loanBlocked ? 'New Loans Blocked' : 'New Loans Open'}</em>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!loanBlocked}
            aria-label="Borrow Guard"
            className={`bwx-switch2 ${loanBlocked ? 'blocked' : 'open'}`}
            disabled={guardBusy}
            onClick={() => void toggleLoanBlock()}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ---- real account totals, using Markets' four-tile grammar ------- */}
      <section className="mkx-stats bwx-health" aria-label="Loan health">
        <h2>Loan Health</h2>
        <p className="mkx-blurb">
          {activeCount > 0
            ? `${activeCount} active ${activeCount === 1 ? 'position is' : 'positions are'} monitored by the engine. Current debt is ${fmtPrice(totalDebtUsd)} against ${fmtPrice(collateralUsd)} in posted collateral.`
            : 'There are no active flexible-loan or cross-margin debts on the connected account.'}
        </p>
        <div className="mkx-tiles bwx-health-tiles">
          <div className="mkx-tile bwx-health-tile">
            <span className="mkx-tile-k">Total Debt</span>
            <span className="mkx-tile-v">
              <b>{loans ? fmtPrice(totalDebtUsd) : '—'}</b>
              <em className="mkx-dim2">{activeCount} Active</em>
            </span>
            <div className="bwx-tile-breakdown">
              <span><em>Flexible</em><b>{fmtPrice(flexDebtUsd)}</b></span>
              <span><em>Margin</em><b>{fmtPrice(marginDebtUsd)}</b></span>
            </div>
            <span className="bwx-debt-track" aria-hidden="true">
              <i style={{ width: `${flexibleDebtShare}%` }} />
            </span>
          </div>
          <div className="mkx-tile bwx-health-tile">
            <span className="mkx-tile-k">Posted Collateral</span>
            <span className="mkx-tile-v">
              <b>{loans ? fmtPrice(collateralUsd) : '—'}</b>
              <em className="mkx-dim2">Flexible Loan</em>
            </span>
            <div className="bwx-collateral-line">
              {primaryLoan ? (
                <>
                  <TokenIcon symbol={`${primaryLoan.collateralCoin}USDT`} size={28} />
                  <span><b>{fmtQty(primaryLoan.collateralAmount)} {primaryLoan.collateralCoin}</b><em>Includes Simple Earn Collateral</em></span>
                </>
              ) : <span><b>No Collateral Posted</b><em>No Flexible Loan Position</em></span>}
            </div>
          </div>
          <div className="mkx-tile bwx-health-tile">
            <span className="mkx-tile-k">Current LTV</span>
            <span className="mkx-tile-v">
              <b>{highestLtvLoan ? ltvPct(maxLoanLtv, 2) : '—'}</b>
              {healthRisk ? <em className={`bwx-risk ${healthRisk}`}>{RISK_LABEL[healthRisk]}</em> : <em className="mkx-dim2">No Position</em>}
            </span>
            {healthZones ? (
              <>
                <span className="bwx-meter bwx-health-meter" aria-hidden="true">
                  <i className="z-low" style={{ width: `${healthZones.low}%` }} />
                  <i className="z-call" style={{ width: `${healthZones.call}%` }} />
                  <i className="z-liq" style={{ width: `${healthZones.liq}%` }} />
                  <u style={{ left: `${healthZones.marker}%` }} />
                </span>
                <span className="bwx-thresholds"><em>{ltvPct(healthInitialLtv)} Initial</em><em>{ltvPct(healthCallLtv)} Call</em><em>{ltvPct(healthLiqLtv)} Liquidation</em></span>
              </>
            ) : <span className="bwx-tile-note">No LTV Exposure</span>}
          </div>
          <div className="mkx-tile bwx-health-tile">
            <span className="mkx-tile-k">Net Borrow Rate</span>
            <span className="mkx-tile-v">
              <b>{finite(primaryNetApr) ? `${primaryNetApr.toFixed(2)}%` : '—'}</b>
              <em className="mkx-dim2">Annualized</em>
            </span>
            <div className="bwx-rate-grid">
              <span><em>Borrow</em><b>{finite(primaryApr) ? `${primaryApr.toFixed(2)}%` : '—'}</b></span>
              <span><em>Earn</em><b className="up">{finite(primaryCollateralApr) ? `${primaryCollateralApr.toFixed(2)}%` : '—'}</b></span>
              <span><em>Net</em><b>{finite(primaryNetApr) ? `${primaryNetApr.toFixed(2)}%` : '—'}</b></span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- one dense positions surface, not a field grid --------------- */}
      <section className="mkx-prices bwx-console bwx-positions" aria-label="Loan positions">
        <div className="mkx-prices-head bwx-positions-head">
          <div className="mkx-prices-title">
            <h2>Loan Positions <em>{activeCount} Active</em></h2>
          </div>
          <div className="bwx-view-tabs" role="tablist" aria-label="Loan position views">
            <button type="button" role="tab" aria-selected={loanView === 'orders'} className={loanView === 'orders' ? 'on' : ''} onClick={() => setLoanView('orders')}>
              Ongoing Orders <span>{activeCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={loanView === 'overview'} className={loanView === 'overview' ? 'on' : ''} onClick={() => setLoanView('overview')}>
              Asset Overview
            </button>
            <button type="button" role="tab" aria-selected={loanView === 'activity'} className={loanView === 'activity' ? 'on' : ''} onClick={() => setLoanView('activity')}>
              Loan Activity <span>{activity.length}</span>
            </button>
          </div>
        </div>

        <div className="bwx-console-body">
          {loanView === 'orders' ? (
            ongoing.length === 0 && marginDebts.length === 0 ? (
              <div className="bwx-empty">No Active Loan Orders.</div>
            ) : (
              <div className="bwx-table-scroll">
                <table className="mkx-table bwx-position-table">
                  <thead>
                    <tr>
                      <th className="mkx-starcol" />
                      <th className="l">Asset</th>
                      <th className="r">Debt</th>
                      <th className="r">Collateral</th>
                      <th className="r">Current LTV</th>
                      <th className="r">Margin Call</th>
                      <th className="r">Liquidation</th>
                      <th className="r">Rates</th>
                      <th className="r">Net APR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ongoing.map((o) => {
                      const terms = collateralFor(o.collateralCoin);
                      const initialLTV = terms?.initialLTV ?? 0.78;
                      const callLTV = terms?.marginCallLTV ?? 0.85;
                      const liqLTV = terms?.liquidationLTV ?? 0.91;
                      const risk = riskOf(o.currentLTV, callLTV, liqLTV);
                      const zones = meterZones(callLTV, liqLTV, o.currentLTV);
                      const borrowApr = (loans?.loanable ?? []).find((c) => c.loanCoin === o.loanCoin)?.yearlyRatePct ?? null;
                      const collEarnApr = earnAprs.get(o.collateralCoin) ?? null;
                      const netApr = finite(borrowApr) ? borrowApr - (collEarnApr ?? 0) : null;
                      const spot = priceOf(o.loanCoin);
                      const collUsd = o.collateralAmount * (priceOf(o.collateralCoin) ?? 0);
                      const liqPrice = o.totalDebt > 0 ? (liqLTV * collUsd) / o.totalDebt : null;
                      const liqDelta = finite(liqPrice) && finite(spot) && spot > 0 ? ((liqPrice - spot) / spot) * 100 : null;
                      const symbol = marketSymbols.has(`${o.loanCoin}USDT`) ? `${o.loanCoin}USDT` : null;
                      return (
                        <tr key={`${o.loanCoin}-${o.collateralCoin}`} className={symbol ? 'link' : ''} onClick={() => symbol && openDetail(symbol)}>
                          <td className="mkx-starcol">{symbol ? <Star on={watchlist.includes(symbol)} onClick={() => void toggleWatch(symbol)} /> : null}</td>
                          <td className="l mkx-asset">
                            <TokenIcon symbol={`${o.loanCoin}USDT`} size={36} />
                            <span className="mkx-asset-name"><b>{tokenName(o.loanCoin)}</b><em>{o.loanCoin} · Flexible Rate</em></span>
                          </td>
                          <td className="r"><span className="bwx-cell-main">{fmtQty(o.totalDebt)} {o.loanCoin}</span><span className="bwx-cell-sub">{fmtPrice(o.totalDebt * (spot ?? 0))}</span></td>
                          <td className="r"><span className="bwx-cell-main">{fmtQty(o.collateralAmount)} {o.collateralCoin}</span><span className="bwx-cell-sub">{fmtPrice(collUsd)} · Simple Earn</span></td>
                          <td className="r bwx-ltv-cell">
                            <span className="bwx-cell-main">{ltvPct(o.currentLTV, 2)} <em className={`bwx-risk ${risk}`}>{RISK_LABEL[risk]}</em></span>
                            <span className="bwx-meter" aria-hidden="true"><i className="z-low" style={{ width: `${zones.low}%` }} /><i className="z-call" style={{ width: `${zones.call}%` }} /><i className="z-liq" style={{ width: `${zones.liq}%` }} /><u style={{ left: `${zones.marker}%` }} /></span>
                          </td>
                          <td className="r"><span className="bwx-cell-main">{ltvPct(callLTV)}</span><span className="bwx-cell-sub">Initial {ltvPct(initialLTV)}</span></td>
                          <td className="r"><span className="bwx-cell-main">{ltvPct(liqLTV)}</span><span className="bwx-cell-sub">{finite(liqPrice) ? `${fmtPrice(liqPrice)} / ${o.loanCoin}${finite(liqDelta) ? ` · ${fmtPct(liqDelta, 1)} Spot` : ''}` : '—'}</span></td>
                          <td className="r"><span className="bwx-cell-main">{finite(borrowApr) ? `${borrowApr.toFixed(2)}%` : '—'}</span><span className="bwx-cell-sub bwx-up">Earn {finite(collEarnApr) ? `${collEarnApr.toFixed(2)}%` : '—'}</span></td>
                          <td className="r"><span className="bwx-cell-main">{finite(netApr) ? `${netApr.toFixed(2)}%` : '—'}</span><span className="bwx-cell-sub">Annualized</span></td>
                        </tr>
                      );
                    })}
                    {marginDebts.map((a) => {
                      const symbol = marketSymbols.has(`${a.asset}USDT`) ? `${a.asset}USDT` : null;
                      const debt = a.borrowed + a.interest;
                      return (
                        <tr key={`margin-${a.asset}`} className={symbol ? 'link' : ''} onClick={() => symbol && openDetail(symbol)}>
                          <td className="mkx-starcol">{symbol ? <Star on={watchlist.includes(symbol)} onClick={() => void toggleWatch(symbol)} /> : null}</td>
                          <td className="l mkx-asset"><TokenIcon symbol={`${a.asset}USDT`} size={36} /><span className="mkx-asset-name"><b>{tokenName(a.asset)}</b><em>{a.asset} · Cross Margin</em></span></td>
                          <td className="r"><span className="bwx-cell-main">{fmtQty(debt)} {a.asset}</span><span className="bwx-cell-sub">{fmtPrice(debt * (priceOf(a.asset) ?? 0))}</span></td>
                          <td className="r"><span className="bwx-cell-main">Account Pool</span><span className="bwx-cell-sub">Cross Margin Collateral</span></td>
                          <td className="r"><span className="bwx-cell-main">—</span><span className="bwx-cell-sub">Margin Level {margin && finite(margin.marginLevel) ? margin.marginLevel.toFixed(2) : '—'}</span></td>
                          <td className="r"><span className="bwx-cell-main">—</span><span className="bwx-cell-sub">Account Level</span></td>
                          <td className="r"><span className="bwx-cell-main">—</span><span className="bwx-cell-sub">Cross Margin</span></td>
                          <td className="r"><span className="bwx-cell-main">{fmtQty(a.interest)} {a.asset}</span><span className="bwx-cell-sub">Accrued Interest</span></td>
                          <td className="r"><span className="bwx-cell-main">Bot</span><span className="bwx-cell-sub">Engine Repay</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : loanView === 'overview' ? (
            debtAssets.length === 0 && collateralAssets.length === 0 ? <div className="bwx-empty">No Borrow Assets To Show.</div> : (
              <div className="bwx-table-scroll">
                <table className="mkx-table bwx-overview-table">
                  <thead><tr><th className="mkx-starcol" /><th className="l">Asset</th><th className="l">Exposure</th><th className="r">Amount</th><th className="r">Value</th><th className="r">Share</th></tr></thead>
                  <tbody>
                    {[...debtAssets.map((r) => ({ ...r, exposure: 'Debt' as const, total: totalDebtUsd })), ...collateralAssets.map((r) => ({ ...r, exposure: 'Collateral' as const, total: collateralUsd }))].map((r) => (
                      <tr key={`${r.exposure}-${r.coin}`} className={r.symbol ? 'link' : ''} onClick={() => r.symbol && openDetail(r.symbol)}>
                        <td className="mkx-starcol">{r.symbol ? <Star on={watchlist.includes(r.symbol)} onClick={() => void toggleWatch(r.symbol as string)} /> : null}</td>
                        <td className="l mkx-asset"><TokenIcon symbol={r.symbol ?? `${r.coin}USDT`} size={36} /><span className="mkx-asset-name"><b>{tokenName(r.coin)}</b><em>{r.coin}</em></span></td>
                        <td className="l"><span className={`bwx-exposure ${r.exposure.toLowerCase()}`}>{r.exposure}</span></td>
                        <td className="r"><span className="bwx-cell-main">{fmtQty(r.qty)} {r.coin}</span></td>
                        <td className="r"><span className="bwx-cell-main">{fmtPrice(r.usd)}</span></td>
                        <td className="r"><span className="bwx-cell-main">{r.total > 0 ? `${((r.usd / r.total) * 100).toFixed(1)}%` : '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : activity.length === 0 ? (
            <div className="bwx-empty">No Flexible-Loan History Returned Yet. Active Positions Remain Live Account State.</div>
          ) : (
            <div className="bwx-table-scroll">
              <table className="mkx-table bwx-activity-table">
                <thead><tr><th className="l">Event</th><th className="l">Loan Asset</th><th className="l">Collateral</th><th className="r">Status</th><th className="r">Time</th></tr></thead>
                <tbody>{activity.slice(0, 20).map((e, i) => (
                  <tr key={`${e.kind}-${e.ts}-${e.loanCoin}-${i}`}>
                    <td className="l"><span className="bwx-activity-event"><i className={`tbp-dot ${activityTone(e.kind)}`} /><span><b>{activityTitle(e)}</b><em>{activityDetail(e)}</em></span></span></td>
                    <td className="l"><span className="bwx-cell-main">{e.loanCoin || '—'}</span></td>
                    <td className="l"><span className="bwx-cell-main">{e.collateralCoin || '—'}</span></td>
                    <td className="r"><span className={`bwx-status ${activityTone(e.kind)}`}>{statusLabel(e.status)}</span></td>
                    <td className="r"><span className="bwx-cell-main">{timeAgo(e.ts)}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---- the screener: every loanable asset --------------------------- */}
      <section className="mkx-prices bwx-market" aria-label="Borrow market">
        <div className="mkx-prices-head bwx-market-head">
          <div className="mkx-prices-title">
            <h2>Borrow Market <em>{filtered.length} Assets</em></h2>
            <span className={`mkx-live ${live ? 'on' : ''}`}><i />{live ? `Live${loans?.fetchedAt ? ` · ${timeAgo(loans.fetchedAt)}` : ''}` : 'Loading'}</span>
          </div>
          <label className="mkx-search bwx-market-search">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.6" cy="8.6" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m12.8 12.8 4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <input placeholder="Search Asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
            {search && <button type="button" aria-label="Clear asset search" onClick={() => setSearch('')}>×</button>}
          </label>
        </div>
        <div className="mkx-pills bwx-market-controls">
          <PillSelect
            value={avail}
            options={[{ id: 'all', label: 'All Loanable' }, { id: 'basis', label: 'Basis-Ready' }]}
            onChange={setAvail}
            ariaLabel="Availability filter"
          />
          <PillSelect
            value={String(pageSize)}
            options={[10, 25, 50, 100].map((n) => ({ id: String(n), label: `${n} Rows` }))}
            onChange={(n) => setPageSize(Number(n))}
            ariaLabel="Rows per page"
          />
        </div>

        <div className="bwx-table-scroll bwx-market-table-scroll">
          <table className="mkx-table bwx-table">
            <thead>
              <tr>
                <th className="mkx-starcol" />
                <SortHead label="Asset" k="asset" right={false} />
                <SortHead label="Hourly Rate" k="hourly" />
                <SortHead label="APR" k="apr" />
                <SortHead label="Max Limit" k="max" />
                <SortHead label="Basis" k="perp" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.coin} className={r.symbol ? 'link' : ''} onClick={() => r.symbol && openDetail(r.symbol)}>
                  <td className="mkx-starcol">
                    {r.symbol ? <Star on={watchlist.includes(r.symbol)} onClick={() => void toggleWatch(r.symbol as string)} /> : null}
                  </td>
                  <td className="l mkx-asset">
                    <TokenIcon symbol={r.symbol ?? `${r.coin}USDT`} size={36} />
                    <span className="mkx-asset-name">
                      <b>{tokenName(r.coin)}</b>
                      <em>{r.coin} · Flexible Rate</em>
                    </span>
                  </td>
                  <td className="r mkx-num"><span>{fmtRate(r.hourly, 5)}</span></td>
                  <td className="r mkx-num"><span>{fmtRate(r.apr, 2)}</span></td>
                  <td className="r mkx-num"><span>{finite(r.max) ? fmtQty(r.max) : '—'}</span></td>
                  <td className="r"><span className={`bwx-avail ${r.perp ? 'ok' : 'dim'}`}>{r.perp ? 'Perp' : '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <nav className="mkx-pager" aria-label="Pagination">
            <button className="mkx-page-nav" disabled={safePage === 0} onClick={() => setPageN(safePage - 1)} aria-label="Previous page">
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M10 3.5L5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {pageList(safePage, pages).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="mkx-page-ellipsis">…</span>
              ) : (
                <button key={p} className={`mkx-page ${safePage === p ? 'current' : ''}`} onClick={() => setPageN(p)}>{p + 1}</button>
              ),
            )}
            <button className="mkx-page-nav" disabled={safePage >= pages - 1} onClick={() => setPageN(safePage + 1)} aria-label="Next page">
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </nav>
        )}
        <p className="mkx-rangeline">{filtered.length ? `${safePage * pageSize + 1}-${safePage * pageSize + visible.length} Of ${filtered.length} Assets` : 'Nothing Matches'}</p>
      </section>

    </div>
  );
}
