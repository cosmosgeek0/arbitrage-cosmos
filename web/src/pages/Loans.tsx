/* Borrow — bot-operated lending, monitoring only. Nothing here places, repays,
   or adjusts a loan; the engine does all of that in the backend (gated +
   ledgered routes). The page tells the truth — debt, LTV, interest, history,
   the loanable universe — and carries exactly ONE control: the owner's Borrow
   Guard kill-switch. Anatomy: bwx hero + Binance ongoing-order stat grid,
   Markets-style screener. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Pill } from '../components/px';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect, pageList, Star } from '../components/PillSelect';
import { tokenName } from '../lib/tokenNames';
import { fmtPrice, fmtPct, fmtQty, timeAgo } from '../format';
import type { BorrowGuardConfig, LoansSnapshot } from '../types';
import './Markets.css';

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
    e.status,
    e.detail && !e.detail.includes('Flexible loan') ? e.detail : null,
  ].filter(Boolean);
  return parts.join(' · ');
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
    <th className={right ? 'r' : 'l'} aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button className="acb-sort" type="button" onClick={() => { if (sortKey === k) setSortDesc((v) => !v); else { setSortKey(k); setSortDesc(k !== 'asset' && k !== 'hourly' && k !== 'apr'); } }}>
        {label}
        <i>{sortKey === k ? (sortDesc ? '▾' : '▴') : ''}</i>
      </button>
    </th>
  );

  return (
    <div className="container page mkx bwx-page">
      {/* ---- hero card — Account anatomy: label, big value, quartet ------- */}
      <header className="hp-group bwx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-id">
            <div className="acb-label-row">
              <span className="acb-label">Total Debt</span>
              <Pill tone={live ? 'ok' : 'idle'}>{live ? `Catalog Live${loans?.fetchedAt ? ` · ${timeAgo(loans.fetchedAt)}` : ''}` : 'Catalog Loading'}</Pill>
            </div>
            <div className="acb-value">{loans ? fmtPrice(totalDebtUsd) : '—'}</div>
            <div className="acb-approx">
              {primaryLoan ? `${fmtQty(primaryLoan.totalDebt)} ${primaryLoan.loanCoin} Flexible · ` : ''}Flexible Loan {fmtPrice(flexDebtUsd)} · Cross Margin {fmtPrice(marginDebtUsd)} · Bot-Operated
            </div>
          </div>
          <div className="bwx-guard">
            <span className="bwx-guard-copy">
              <b>Borrow Guard</b>
              <em className={loanBlocked ? 'blocked' : 'open'}>{loanBlocked ? 'Loans Blocked' : 'Loans Open'}</em>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={loanBlocked}
              aria-label="Borrow Guard"
              className={`bwx-switch2 ${loanBlocked ? 'blocked' : 'open'}`}
              disabled={guardBusy}
              onClick={() => void toggleLoanBlock()}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Collateral Posted</em>
            <b>{loans ? fmtPrice(collateralUsd) : '—'}</b>
            <small>{primaryLoan ? `${fmtQty(primaryLoan.collateralAmount)} ${primaryLoan.collateralCoin}` : 'No Collateral'}</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Active Orders</em>
            <b>{loans ? ongoing.length + marginDebts.length : '—'}</b>
            <small>{ongoing.length} Flexible · {marginDebts.length} Margin</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Current LTV</em>
            <b>{ongoing.length ? ltvPct(maxLoanLtv, 2) : '—'}</b>
            <small>Debt / Collateral</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Borrow APR</em>
            <b>{primaryApr !== null ? `${primaryApr.toFixed(2)}%` : '—'}</b>
            <small>Flexible Rate · Hourly Accrual</small>
          </div>
        </div>
      </header>

      {/* ---- loan console: orders, overview, activity --------------------- */}
      <section className="hp-group bwx-console">
        <div className="acb-tabs">
          <button type="button" className={loanView === 'orders' ? 'on' : ''} onClick={() => setLoanView('orders')}>
            Ongoing Orders <b>({ongoing.length + marginDebts.length})</b>
          </button>
          <button type="button" className={loanView === 'overview' ? 'on' : ''} onClick={() => setLoanView('overview')}>
            Asset Overview
          </button>
          <button type="button" className={loanView === 'activity' ? 'on' : ''} onClick={() => setLoanView('activity')}>
            Loan Activity <b>({activity.length})</b>
          </button>
        </div>

        <div className="bwx-console-body">
          {loanView === 'orders' ? (
            ongoing.length === 0 && marginDebts.length === 0 ? (
              <div className="acb-act-empty">No Active Loan Orders.</div>
            ) : (
              <>
                {ongoing.map((o) => {
                  const terms = collateralFor(o.collateralCoin);
                  const initialLTV = terms ? terms.initialLTV : 0.78;
                  const callLTV = terms ? terms.marginCallLTV : 0.85;
                  const liqLTV = terms ? terms.liquidationLTV : 0.91;
                  const risk = riskOf(o.currentLTV, callLTV, liqLTV);
                  const zones = meterZones(callLTV, liqLTV, o.currentLTV);
                  const borrowApr = (loans?.loanable ?? []).find((c) => c.loanCoin === o.loanCoin)?.yearlyRatePct ?? null;
                  const collEarnApr = earnAprs.get(o.collateralCoin) ?? null;
                  const netApr = finite(borrowApr) ? borrowApr - (collEarnApr ?? 0) : null;
                  const spot = priceOf(o.loanCoin);
                  const collUsd = o.collateralAmount * (priceOf(o.collateralCoin) ?? 0);
                  const liqPrice = o.totalDebt > 0 ? (liqLTV * collUsd) / o.totalDebt : null;
                  const liqDelta = finite(liqPrice) && finite(spot) && spot > 0 ? ((liqPrice - spot) / spot) * 100 : null;
                  return (
                    <article key={`${o.loanCoin}-${o.collateralCoin}`} className="bwx-loan2">
                      <div className="bwx-loan2-head">
                        <TokenIcon symbol={`${o.loanCoin}USDT`} size={34} />
                        <b>{o.loanCoin}</b>
                        <em>Flexible Rate Loan · Collateral {o.collateralCoin}</em>
                      </div>
                      <div className="bwx-loan2-grid">
                        <div className="bwx-kv">
                          <em>Total Debt ({o.loanCoin})</em>
                          <b>{fmtQty(o.totalDebt)}</b>
                          <small>{fmtPrice(o.totalDebt * (spot ?? 0))}</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Current LTV</em>
                          <b>{ltvPct(o.currentLTV, 2)}<span className={`bwx-risk ${risk}`}>{RISK_LABEL[risk]}</span></b>
                          <span className="bwx-meter" aria-hidden="true">
                            <i className="z-low" style={{ width: `${zones.low}%` }} />
                            <i className="z-call" style={{ width: `${zones.call}%` }} />
                            <i className="z-liq" style={{ width: `${zones.liq}%` }} />
                            <u style={{ left: `${zones.marker}%` }} />
                          </span>
                        </div>
                        <div className="bwx-kv">
                          <em>Margin Call</em>
                          <b>{ltvPct(callLTV)}</b>
                          <small>Initial LTV {ltvPct(initialLTV)}</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Liquidation LTV</em>
                          <b>{ltvPct(liqLTV)}</b>
                          <small>{finite(liqPrice) ? `${fmtPrice(liqPrice)} Per ${o.loanCoin}${finite(liqDelta) ? ` · ${fmtPct(liqDelta, 1)} From Spot` : ''}` : '—'}</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Collateral Incl. Simple Earn</em>
                          <b>{fmtQty(o.collateralAmount)} {o.collateralCoin}</b>
                          <small>{fmtPrice(collUsd)}</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Borrow APR</em>
                          <b>{finite(borrowApr) ? `${borrowApr.toFixed(2)}%` : '—'}</b>
                          <small>Flexible Rate · Hourly Accrual</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Collateral Earns</em>
                          <b className={finite(collEarnApr) && collEarnApr > 0 ? 'up' : ''}>{finite(collEarnApr) ? `${collEarnApr.toFixed(2)}%` : '—'}</b>
                          <small>Simple Earn APR</small>
                        </div>
                        <div className="bwx-kv">
                          <em>Net APR</em>
                          <b>{finite(netApr) ? `${netApr.toFixed(2)}%` : '—'}</b>
                          <small>Borrow − Collateral Earn</small>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {marginDebts.map((a) => (
                  <article key={a.asset} className="bwx-loan2">
                    <div className="bwx-loan2-head">
                      <TokenIcon symbol={`${a.asset}USDT`} size={34} />
                      <b>{a.asset}</b>
                      <em>Cross Margin · Interest Accruing</em>
                      <span className="bwx-risk call">Margin Debt</span>
                    </div>
                    <div className="bwx-loan2-grid">
                      <div className="bwx-kv">
                        <em>Borrowed</em>
                        <b>{fmtQty(a.borrowed)} {a.asset}</b>
                        <small>{fmtPrice(a.borrowed * (priceOf(a.asset) ?? 0))}</small>
                      </div>
                      <div className="bwx-kv">
                        <em>Interest</em>
                        <b>{fmtQty(a.interest)} {a.asset}</b>
                        <small>{fmtPrice(a.interest * (priceOf(a.asset) ?? 0))}</small>
                      </div>
                      <div className="bwx-kv">
                        <em>Margin Level</em>
                        <b>{margin && finite(margin.marginLevel) ? margin.marginLevel.toFixed(2) : '—'}</b>
                        <small>Account Level</small>
                      </div>
                      <div className="bwx-kv">
                        <em>Repaid By</em>
                        <b>Bot</b>
                        <small>Engine Manages Margin Debt</small>
                      </div>
                    </div>
                  </article>
                ))}
              </>
            )
          ) : loanView === 'overview' ? (
            <div className="bwx-over">
              <AssetOverviewCard title="Total Debt Amount" value={loans ? fmtPrice(totalDebtUsd) : '—'} rows={debtAssets} />
              <AssetOverviewCard title="Total Collateral Amount" value={loans ? fmtPrice(collateralUsd) : '—'} rows={collateralAssets} />
            </div>
          ) : activity.length === 0 ? (
            <div className="acb-act-empty">No Flexible-Loan History Returned Yet. Active Loans Above Are Live Account State.</div>
          ) : (
            <div className="bwx-feed">
              {activity.slice(0, 20).map((e, i) => (
                <div key={`${e.kind}-${e.ts}-${e.loanCoin}-${i}`} className="bwx-feed-row">
                  <span className={`tbp-dot ${activityTone(e.kind)}`} />
                  <span className="bwx-feed-label">
                    <b>{activityTitle(e)}</b>
                    <em>{activityDetail(e)}</em>
                  </span>
                  <span className="bwx-feed-time">{timeAgo(e.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- the screener: every loanable asset --------------------------- */}
      <section className="hp-group bwx-market">
        <div className="bwx-market-head">
          <h2>Borrow Market <em>{filtered.length} Assets</em></h2>
        </div>
        <div className="bwx-market-controls">
          <div className="bwx-market-filters">
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
          <input className="hp-input acb-search bwx-market-search" placeholder="Search Asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        </div>

        <table className="acb-table bwx-table">
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
                <td className="l acb-asset">
                  <TokenIcon symbol={r.symbol ?? `${r.coin}USDT`} size={36} />
                  <span className="acb-asset-name">
                    <b>{r.coin}</b>
                    <em>{tokenName(r.coin)}</em>
                  </span>
                </td>
                <td className="r acb-num"><span className="acb-cell-main">{fmtRate(r.hourly, 5)}</span></td>
                <td className="r acb-num"><span className="acb-cell-main">{fmtRate(r.apr, 2)}</span></td>
                <td className="r acb-num"><span className="acb-cell-main">{finite(r.max) ? fmtQty(r.max) : '—'}</span></td>
                <td className="r"><span className={`bwx-avail ${r.perp ? 'ok' : 'dim'}`}>{r.perp ? 'Perp' : '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>

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

function AssetOverviewCard({
  title,
  value,
  rows,
}: {
  title: string;
  value: string;
  rows: { coin: string; qty: number; usd: number; symbol: string | null }[];
}) {
  return (
    <section className="bwx-over-card">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <div className="bwx-over-head">
        <span>Asset</span>
        <span>Amount</span>
        <span>Value</span>
      </div>
      {rows.length === 0 ? (
        <div className="bwx-over-empty">No Positions</div>
      ) : (
        rows.map((r) => (
          <div key={r.coin} className="bwx-over-row">
            <span className="bwx-over-asset">
              <TokenIcon symbol={r.symbol ?? `${r.coin}USDT`} size={30} />
              <b>{r.coin}</b>
            </span>
            <span>{fmtQty(r.qty)}</span>
            <span>{fmtPrice(r.usd)}</span>
          </div>
        ))
      )}
    </section>
  );
}
