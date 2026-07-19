import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { TokenIcon } from '../components/TokenIcon';
import { IconSearch } from '../components/Icons';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { useProductControlRoomContext } from '../features/productControlRoom/ProductControlRoomProvider';
import { fmtBasis, fmtMoney, timeAgo } from '../format';
import type { BasisRow, BasisSnapshot } from '../lib/basisRuntime';
import './Markets.css';
import './Loans.css';

type LoanView = 'overview' | 'assets' | 'preflight' | 'activity';

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
  const { openDetail, setPage } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
  const [basis, setBasis] = useState<BasisSnapshot | null>(null);
  const [basisError, setBasisError] = useState<string | null>(null);
  const [view, setView] = useState<LoanView>('overview');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const poll = createSettledPoll<BasisSnapshot>({
      intervalMs: 2_000,
      request: (signal) => fetchJson('/api/engine/basis', { cache: 'no-store', signal }),
      onSuccess: (next) => {
        setBasis(next);
        setBasisError(null);
      },
      onError: (error) => setBasisError(apiErrorMessage(error, 'Basis Runtime Unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  const preflightRows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return (basis?.rows ?? [])
      .filter((row) => row.direction === 'short_spot_long_perp')
      .filter((row) => !query || row.base.includes(query) || row.symbol.includes(query))
      .sort((a, b) => (b.executableGapPct ?? Number.NEGATIVE_INFINITY) - (a.executableGapPct ?? Number.NEGATIVE_INFINITY));
  }, [basis?.rows, search]);

  const basisRuntimeError = basisError ?? basis?.status.lastError ?? null;
  const basisLive = !!basis && !basisRuntimeError;
  const borrowSurface = productBinding.snapshot?.surfaces.borrow ?? null;
  const borrowDatum = (fieldId: string) => borrowSurface?.evidence.find((datum) => datum.fieldId === fieldId) ?? null;
  const currentBorrowed = borrowDatum('current-borrowed');
  const accruedInterest = borrowDatum('accrued-interest');
  const collateralAmount = borrowDatum('collateral-amount');
  const currentLtv = borrowDatum('current-ltv');
  const privateState = productBinding.continuity !== 'PROVEN'
    ? 'UNAVAILABLE'
    : borrowSurface?.truthLabel ?? 'UNAVAILABLE';
  const privateSource = borrowSurface?.canonicalSource ?? 'systemIntegration supervisor:borrow';
  const sourceTone = view === 'preflight' ? (basisLive ? 'on' : basis ? 'partial' : '') : borrowSurface ? 'partial' : '';
  const sourceText = view === 'preflight'
    ? basisRuntimeError
      ? `Public Source Error · ${basis ? 'Cached' : 'No Data'}`
      : basis
        ? `Public Basis · ${timeAgo(basis.updatedAt)}`
        : 'Loading Public Basis'
    : `${privateSource.replace(/_/g, ' ')} · ${privateState}`;
  const viewCounts: Record<LoanView, string> = {
    overview: '—',
    assets: '—',
    preflight: basis ? String(preflightRows.length) : '—',
    activity: '—',
  };

  return (
    <div className="container page borrowx-page">
      <section className="borrowx-frame" aria-label="Borrow Workspace">
        <header className="borrowx-toolbar">
          <div className="borrowx-identity">
            <span className="borrowx-source-mark"><img className="borrowx-page-mark" src="/borrow-money-bag.png" alt="" aria-hidden="true" /></span>
            <span><h1>Borrow</h1><small>Public Preflight · Private Truth Owner Gated</small></span>
          </div>
          <div className="borrowx-tools">
            <label className="borrowx-search"><IconSearch size={15} /><input aria-label="Search Borrow" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false} />{search && <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>×</button>}</label>
            <div className="borrowx-guard" aria-label="New Loans Owner Gated">
              <span><b>New Loans</b><small className="bad">Not Configured</small></span>
              <span className="borrowx-chip warn">Owner Gated</span>
            </div>
          </div>
        </header>

        <div className="borrowx-summary" aria-label="Borrow Summary">
          <article><span>Current Borrowed</span><strong>{currentBorrowed?.value ?? '—'}</strong><small>{currentBorrowed?.canonicalSource ?? 'Liability source unavailable'} · {currentBorrowed?.truthLabel ?? privateState}</small></article>
          <article><span>Accrued Interest</span><strong>{accruedInterest?.value ?? '—'}</strong><small>{accruedInterest?.canonicalSource ?? 'Liability freshness unavailable'} · {accruedInterest?.truthLabel ?? privateState}</small></article>
          <article><span>Posted Collateral</span><strong>{collateralAmount?.value ?? '—'}</strong><small>{collateralAmount?.canonicalSource ?? 'Collateral source unavailable'} · {collateralAmount?.truthLabel ?? privateState}</small></article>
          <article><span>Current LTV</span><strong>{currentLtv?.value ?? '—'}</strong><small>{currentLtv?.canonicalSource ?? 'Venue LTV freshness unavailable'} · {currentLtv?.truthLabel ?? privateState}</small></article>
        </div>

        <ProductSurfaceAdapter surfaceId="borrow" />

        <nav className="borrowx-viewbar" aria-label="Borrow Views">
          <div role="tablist">
            {([
              ['overview', 'Overview'],
              ['assets', 'Assets'],
              ['preflight', 'Borrow Preflight'],
              ['activity', 'Activity'],
            ] as [LoanView, string][]).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
                {label}<span>{viewCounts[id]}</span>
              </button>
            ))}
          </div>
          <span className={`borrowx-live ${sourceTone}`} title={view === 'preflight' ? basisRuntimeError ?? '' : productBinding.error ?? borrowSurface?.blocker ?? 'No authorized private BorrowTruth adapter is mounted'}><i />{sourceText}</span>
        </nav>

        <div className="borrowx-workspace">
          {view === 'overview' && (
            <>
              <section className="borrowx-section" aria-labelledby="borrow-active-title">
                <header className="borrowx-section-head">
                  <span><strong id="borrow-active-title">Active Positions</strong><small>Flexible Loan + Cross Margin</small></span>
                  <span>{privateState} · Owner Gated</span>
                </header>
                <div className="borrowx-empty compact"><span><b>Private Borrow Positions Not Configured</b><small>Unavailable account truth is not reported as zero positions.</small></span></div>
              </section>

              <section className="borrowx-section borrowx-market-section" aria-labelledby="borrow-market-title">
                <header className="borrowx-section-head borrowx-market-head">
                  <span><strong id="borrow-market-title">Loan Market</strong><small>Private Binance loan inventory is NOT_CONFIGURED</small></span>
                  <span className="borrowx-market-count">Inventory Unknown · Owner Gated</span>
                </header>
                <div className="borrowx-empty compact"><span><b>Loan Inventory Not Configured</b><small>No signed/private catalog is fetched by this page.</small></span></div>
              </section>
            </>
          )}

          {view === 'assets' && (
            <div className="borrowx-empty"><span><b>Private Borrow Assets Not Configured</b><small>Debt and collateral exposure remain UNKNOWN until the canonical private owner is mounted.</small></span></div>
          )}

          {view === 'preflight' && (
            <div className="borrowx-table-scroll">
              <table className="borrowx-table preflight">
                <thead><tr><th className="l">Asset</th><th>Executable Gap</th><th>Intended Size</th><th>Borrow Status</th><th>Borrow Cost</th><th className="l">Decision</th><th>Age</th></tr></thead>
                <tbody>{preflightRows.map((row) => (
                  <tr key={row.symbol} tabIndex={0} className="link" onClick={() => openDetail(row.symbol)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(row.symbol); } }}>
                    <td className="l borrowx-asset"><TokenIcon symbol={row.symbol} size={32} /><span><b>{row.base}</b><small>Sell Spot · Buy Perp</small></span></td>
                    <td><b>{fmtBasis(row.executableGapPct)}</b><small>Crossed Books</small></td>
                    <td><b>{fmtMoney(basis?.thresholds.intendedNotionalUsd)}</b><small>Engine Target</small></td>
                    <td><b className={`borrow-${row.borrow.status}`}>{borrowStatusLabel(row)}</b><small>{row.borrow.human}</small></td>
                    <td><b>{row.borrow.status === 'available' ? fmtBasis(row.borrow.costPctOverHold) : '—'}</b><small>{row.borrow.status === 'available' ? 'Canonical Engine Evidence' : 'Private Rate Not Assumed'}</small></td>
                    <td className="l"><b>{decisionLabel(row)}</b><small>{row.reason}</small></td>
                    <td><b>{row.decisionTs ? timeAgo(row.decisionTs) : '—'}</b><small>{Math.round(row.dataQuality.score * 100)}% Trust</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {preflightRows.length === 0 && <div className="borrowx-empty">{basisRuntimeError ?? (basis ? 'No Reverse-Basis Rows In The Current Eligible Universe' : 'Public Basis Evidence Unavailable')}</div>}
            </div>
          )}

          {view === 'activity' && (
            <div className="borrowx-empty"><span><b>Private Loan Activity Not Configured</b><small>No signed/private activity history is fetched, and unavailable history is not reported as empty.</small></span></div>
          )}
        </div>

        <footer className="borrowx-footer">
          <span>{view === 'preflight' ? basisRuntimeError ? `Public Borrow Source Error: ${basisRuntimeError}` : `Public Borrow Source: ${basis?.status.borrowSource ?? 'Loading'}` : `Foundation BorrowTruth: ${privateState} · Liability/Collateral Sources Unavailable`}</span>
          <span>{view === 'preflight' ? basis ? `${preflightRows.length} Public Rows` : 'Public Rows Unknown' : 'Private Counts Unknown'}</span>
          {view === 'preflight' && <button type="button" onClick={() => setPage('strategies')}>Open Basis</button>}
        </footer>
      </section>
    </div>
  );
}
