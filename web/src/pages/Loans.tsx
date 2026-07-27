import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { TokenIcon } from '../components/TokenIcon';
import { IconSearch } from '../components/Icons';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import { fmtBasis, fmtMoney, timeAgo } from '../format';
import { exactOrDash, projectPrivateRead } from '../lib/privateRead';
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
  const { privateRead, privateReadError, openDetail, setPage } = useStore();
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
  const privatePresentation = projectPrivateRead(privateRead);
  const liabilityRows = privateRead.margin.assets?.filter((asset) => asset.borrowed !== '0' || asset.interest !== '0') ?? null;
  const sourceTone = view === 'preflight'
    ? (basisLive ? 'on' : basis ? 'partial' : '')
    : privatePresentation.tone === 'ok' ? 'on' : privatePresentation.tone === 'warn' ? 'partial' : '';
  const sourceText = view === 'preflight'
    ? basisRuntimeError
      ? `Public Source Error · ${basis ? 'Cached' : 'No Data'}`
      : basis
        ? `Public Basis · ${timeAgo(basis.updatedAt)}`
        : 'Loading Public Basis'
    : `Binance Private Read · ${privatePresentation.stateLabel}`;
  const viewCounts: Record<LoanView, string> = {
    overview: liabilityRows === null ? '—' : String(liabilityRows.length),
    assets: privateRead.margin.assets === null ? '—' : String(privateRead.margin.assets.length),
    preflight: basis ? String(preflightRows.length) : '—',
    activity: '—',
  };

  return (
    <div className="container page borrowx-page">
      <section className="borrowx-frame" aria-label="Borrow Workspace">
        <header className="borrowx-toolbar">
          <div className="borrowx-identity">
            <span className="borrowx-source-mark"><img className="borrowx-page-mark" src="/borrow-money-bag.png" alt="" aria-hidden="true" /></span>
            <span><h1>Borrow</h1><small>Public Preflight · Private Liabilities {privatePresentation.stateLabel}</small></span>
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
          <article><span>Margin Liability</span><strong>{exactOrDash(privateRead.margin.totalLiabilityBtc)}</strong><small>{privateRead.margin.totalLiabilityBtc === null ? '— · provider aggregate unavailable' : 'BTC-denominated provider aggregate'}</small></article>
          <article><span>Liability Assets</span><strong>{liabilityRows === null ? '—' : String(liabilityRows.length)}</strong><small>{privateRead.reconciliation.liabilities.state} · {privateRead.reconciliation.liabilities.reason ?? privatePresentation.observedLabel}</small></article>
          <article><span>Total Margin Assets</span><strong>{exactOrDash(privateRead.margin.totalAssetBtc)}</strong><small>{privateRead.margin.totalAssetBtc === null ? '— · aggregate unavailable' : 'BTC-denominated provider aggregate'}</small></article>
          <article><span>Net Margin Assets</span><strong>{exactOrDash(privateRead.margin.totalNetAssetBtc)}</strong><small>{privateRead.margin.state} · {privateRead.margin.coverage.state.replaceAll('_', ' ')}</small></article>
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
          <span className={`borrowx-live ${sourceTone}`} title={view === 'preflight' ? basisRuntimeError ?? '' : privateReadError ?? privateRead.margin.coverage.limitation ?? privatePresentation.reconciliationLabel}><i />{sourceText}</span>
        </nav>

        <div className="borrowx-workspace">
          {view === 'overview' && (
            <>
              <section className="borrowx-section" aria-labelledby="borrow-active-title">
                <header className="borrowx-section-head">
                  <span><strong id="borrow-active-title">Cross Margin Liabilities</strong><small>Borrowed And Accrued Interest Remain In Asset Units</small></span>
                  <span>{privateRead.margin.state} · {privatePresentation.observedLabel}</span>
                </header>
                {liabilityRows === null ? (
                  <div className="borrowx-empty compact"><span><b>Liability Facts Unavailable</b><small>{privateReadError ?? privateRead.reconciliation.liabilities.reason ?? 'Unavailable account truth is not reported as zero liabilities.'}</small></span></div>
                ) : liabilityRows.length === 0 ? (
                  <div className="borrowx-empty compact"><span><b>No Margin Liabilities</b><small>The configured Cross Margin read returned exact observed zero borrowed and interest rows.</small></span></div>
                ) : (
                  <div className="borrowx-table-scroll">
                    <table className="borrowx-table preflight">
                      <thead><tr><th className="l">Asset</th><th>Borrowed</th><th>Interest</th><th>Free</th><th>Locked</th><th>Net Asset</th><th>Freshness</th></tr></thead>
                      <tbody>{liabilityRows.map((asset) => (
                        <tr key={asset.asset}>
                          <td className="l borrowx-asset"><TokenIcon symbol={`${asset.asset}USDT`} size={32} /><span><b>{asset.asset}</b><small>Cross Margin</small></span></td>
                          <td><b>{asset.borrowed}</b><small>Provider Quantity</small></td>
                          <td><b>{asset.interest}</b><small>Accrued</small></td>
                          <td><b>{asset.free}</b><small>Free</small></td>
                          <td><b>{asset.locked}</b><small>Locked</small></td>
                          <td><b>{asset.netAsset}</b><small>Net Asset</small></td>
                          <td><b>{privatePresentation.observedLabel}</b><small>{privateRead.reconciliation.liabilities.state}</small></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="borrowx-section borrowx-market-section" aria-labelledby="borrow-market-title">
                <header className="borrowx-section-head borrowx-market-head">
                  <span><strong id="borrow-market-title">Loan Market</strong><small>Loan catalog is outside private-read v1</small></span>
                  <span className="borrowx-market-count">Inventory Unknown · Owner Gated</span>
                </header>
                <div className="borrowx-empty compact"><span><b>Loan Inventory Not Configured</b><small>No signed/private catalog is fetched by this page.</small></span></div>
              </section>
            </>
          )}

          {view === 'assets' && (
            privateRead.margin.assets === null ? (
              <div className="borrowx-empty"><span><b>Margin Asset Facts Unavailable</b><small>{privateReadError ?? privateRead.margin.coverage.limitation ?? 'The private owner did not publish margin asset rows.'}</small></span></div>
            ) : (
              <div className="borrowx-table-scroll">
                <table className="borrowx-table preflight">
                  <thead><tr><th className="l">Asset</th><th>Free</th><th>Locked</th><th>Borrowed</th><th>Interest</th><th>Net Asset</th><th>State</th></tr></thead>
                  <tbody>{privateRead.margin.assets.map((asset) => (
                    <tr key={asset.asset}>
                      <td className="l borrowx-asset"><TokenIcon symbol={`${asset.asset}USDT`} size={32} /><span><b>{asset.asset}</b><small>Cross Margin</small></span></td>
                      <td><b>{asset.free}</b><small>Free</small></td>
                      <td><b>{asset.locked}</b><small>Locked</small></td>
                      <td><b>{asset.borrowed}</b><small>Borrowed</small></td>
                      <td><b>{asset.interest}</b><small>Accrued</small></td>
                      <td><b>{asset.netAsset}</b><small>Net Asset</small></td>
                      <td><b>{privateRead.margin.state}</b><small>{privatePresentation.observedLabel}</small></td>
                    </tr>
                  ))}</tbody>
                </table>
                {privateRead.margin.assets.length === 0 && <div className="borrowx-empty"><span><b>No Margin Asset Rows</b><small>The configured read returned an exact empty array.</small></span></div>}
              </div>
            )
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
          <span>{view === 'preflight' ? basisRuntimeError ? `Public Borrow Source Error: ${basisRuntimeError}` : `Public Borrow Source: ${basis?.status.borrowSource ?? 'Loading'}` : `Private Liability Truth: ${privateRead.reconciliation.liabilities.state} · Money Actions Blocked`}</span>
          <span>{view === 'preflight' ? basis ? `${preflightRows.length} Public Rows` : 'Public Rows Unknown' : liabilityRows === null ? 'Private Counts Unknown' : `${liabilityRows.length} Liability Assets`}</span>
          {view === 'preflight' && <button type="button" onClick={() => setPage('strategies')}>Open Basis</button>}
        </footer>
      </section>
    </div>
  );
}
