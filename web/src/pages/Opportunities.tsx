/* Opportunities is the proposal queue: every card is a real scanner signal
   with the engine's own numbers — nothing is scored or ranked by invented
   client-side formulas. Radar tabs are labeled market context, not signals. */
import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { SparkArea, Sparkline } from '../components/Spark';
import { EmptyState, StatePill } from '../components/ui';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconLayers,
  IconPercent,
  IconPulse,
  IconRadar,
  IconSearch,
  IconShield,
  IconTicket,
} from '../components/Icons';
import { baseOf, fmtBasis, fmtFunding, fmtMoney, fmtPct, fmtPrice, signClass, timeAgo } from '../format';
import type { MarketRow, Proposal } from '../types';

type View = 'active' | 'basis' | 'funding' | 'volume';
type CandidateKind = 'basis' | 'funding' | 'volume';

const SIDE_LABEL: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp / long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp / short spot',
};

const SIDE_SHORT: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Carry setup',
  LONG_PERP_SHORT_SPOT: 'Borrow setup',
};

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'Active proposals' },
  { id: 'basis', label: 'Basis radar' },
  { id: 'funding', label: 'Funding radar' },
  { id: 'volume', label: 'Liquidity' },
];

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function abs(v: number | null | undefined): number {
  return finite(v) ? Math.abs(v) : 0;
}

function sideForBasis(v: number | null | undefined): Proposal['side'] {
  return (v ?? 0) >= 0 ? 'SHORT_PERP_LONG_SPOT' : 'LONG_PERP_SHORT_SPOT';
}

function edgeDistance(m: MarketRow, threshold: number): number {
  return abs(m.basisPct) - threshold;
}

/** Same arithmetic the scanner uses: gross |basis| minus round-trip fees. */
function netAfterFees(m: MarketRow, feesPct: number): number | null {
  if (!finite(m.basisPct)) return null;
  return abs(m.basisPct) - feesPct;
}

function Metric({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className="opp-metric">
      <span>{label}</span>
      <b className={`num ${tone ?? ''}`}>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function ProposalCard({
  p,
  market,
  watchlisted,
  selected,
  onSelect,
  onApprove,
  onDetail,
  onWatch,
  onReject,
}: {
  p: Proposal;
  market?: MarketRow;
  watchlisted: boolean;
  selected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onDetail: () => void;
  onWatch: () => void;
  onReject: () => void;
}) {
  const borrowRequired = p.side === 'LONG_PERP_SHORT_SPOT';
  const sideTone = borrowRequired ? 'purple' : 'ok';
  return (
    <article className={`opp-proposal-card ${selected ? 'selected' : ''}`}>
      <button className="opp-proposal-main" type="button" onClick={onSelect}>
        <span className="opp-rank-orb">
          <TokenIcon symbol={p.symbol} size={42} />
        </span>
        <span className="opp-title-block">
          <span className="opp-symbol-line">
            <b>{baseOf(p.symbol)}</b>
            <em>{p.symbol}</em>
            <span className={`chip-tag ${sideTone}`}>{SIDE_SHORT[p.side]}</span>
          </span>
          <span className="opp-subline">
            {SIDE_LABEL[p.side]} / opened {timeAgo(p.openedTs)}
          </span>
        </span>
        <span className="opp-score-cell">
          <span>Net edge</span>
          <b className={`num ${signClass(p.netEdgePct)}`}>{fmtPct(p.netEdgePct, 2)}</b>
          <em>after fees {fmtPct(p.feesPct, 2, false)}</em>
        </span>
      </button>

      <div className="opp-proposal-grid">
        <Metric label="Basis now / peak" value={`${fmtBasis(p.basisNow, 2)} / ${fmtBasis(p.basisPeak, 2)}`} tone={signClass(p.basisNow)} />
        <Metric label="Funding" value={fmtFunding(p.fundingRate)} tone={signClass(p.fundingRate)} sub={borrowRequired ? 'borrow leg required' : 'perp carry input'} />
        <Metric label="Confidence" value={`${Math.round(p.confidence * 100)}%`} sub="persistence + liquidity" />
        <Metric label="24h volume" value={fmtMoney(p.quoteVolume24h)} sub="spot quote volume" />
      </div>

      <div className="opp-mini-chart">
        <SparkArea values={market?.spark ?? []} color={brandColor(p.symbol)} dots endDot />
      </div>

      <div className="opp-brief">
        <span>
          <IconAlert size={14} />
          {p.reason}
        </span>
        <span>
          <IconShield size={14} />
          {borrowRequired ? p.borrow : 'No spot borrow required for this direction.'}
        </span>
      </div>

      <div className="opp-actions">
        <button className="cta-pill" type="button" onClick={onApprove}>
          <IconTicket size={14} />
          Approve ticket
        </button>
        <button className="mini-btn" type="button" onClick={onDetail}>
          <IconChart size={14} />
          Market
        </button>
        <button className={`mini-btn ${watchlisted ? 'strong' : ''}`} type="button" onClick={onWatch}>
          <IconRadar size={14} />
          {watchlisted ? 'Watching' : 'Watch'}
        </button>
        <button className="mini-btn" type="button" title="Dismiss this proposal and ledger the action" onClick={onReject}>
          Reject
        </button>
      </div>
    </article>
  );
}

function CandidateRow({
  m,
  kind,
  threshold,
  feesPct,
  watchlisted,
  onDetail,
  onWatch,
}: {
  m: MarketRow;
  kind: CandidateKind;
  threshold: number;
  feesPct: number;
  watchlisted: boolean;
  onDetail: () => void;
  onWatch: () => void;
}) {
  const side = sideForBasis(m.basisPct);
  const distance = edgeDistance(m, threshold);
  const net = netAfterFees(m, feesPct);
  const mainMetric =
    kind === 'funding' ? fmtFunding(m.fundingRate) : kind === 'volume' ? fmtMoney(m.quoteVolume24h) : fmtBasis(m.basisPct, 2);
  const tone = kind === 'funding' ? signClass(m.fundingRate) : kind === 'volume' ? '' : signClass(m.basisPct);
  return (
    <div className="opp-candidate-row">
      <button className="opp-candidate-token" type="button" onClick={onDetail}>
        <TokenIcon symbol={m.symbol} size={32} />
        <span>
          <b>{m.base}</b>
          <em>{m.symbol}</em>
        </span>
      </button>
      <span className="opp-candidate-spark">
        <Sparkline values={m.spark} color={brandColor(m.symbol)} />
      </span>
      <span className={`opp-candidate-value num ${tone}`}>{mainMetric}</span>
      <span className="opp-candidate-detail">
        <b>{SIDE_SHORT[side]}</b>
        <em>{kind === 'basis' ? `${fmtPct(distance, 2)} vs threshold` : `${fmtBasis(m.basisPct, 2)} basis / ${fmtMoney(m.quoteVolume24h)} vol`}</em>
      </span>
      <span className="opp-candidate-score">
        <span>net of fees</span>
        <b className={`num ${net !== null && net >= threshold - feesPct ? 'up' : ''}`}>{net !== null ? fmtPct(net, 2) : '—'}</b>
      </span>
      <span className="opp-candidate-actions">
        <button className="mini-btn" type="button" onClick={onDetail}>Open</button>
        <button className={`mini-btn ${watchlisted ? 'strong' : ''}`} type="button" onClick={onWatch}>{watchlisted ? 'Watching' : 'Watch'}</button>
      </span>
    </div>
  );
}

export function Opportunities() {
  const { state, markets, approveProposal, openDetail, toggleWatch, setPage } = useStore();
  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const s = state;
  const watchlist = s?.config.watchlist ?? [];
  const threshold = s?.scanner.grossThresholdPct ?? 0;
  const active = s?.proposals ?? [];

  const marketBySymbol = useMemo(() => new Map(markets.map((m) => [m.symbol, m])), [markets]);
  const query = search.trim().toUpperCase();

  const liquidPerpRows = useMemo(() => {
    return markets.filter((m) => m.hasPerp && (m.quoteVolume24h ?? 0) >= (s?.config.minQuoteVolume24h ?? 0));
  }, [markets, s?.config.minQuoteVolume24h]);

  const basisRows = useMemo(() => {
    return [...liquidPerpRows].filter((m) => finite(m.basisPct)).sort((a, b) => abs(b.basisPct) - abs(a.basisPct)).slice(0, 18);
  }, [liquidPerpRows]);

  const fundingRows = useMemo(() => {
    return [...liquidPerpRows].filter((m) => finite(m.fundingRate)).sort((a, b) => abs(b.fundingRate) - abs(a.fundingRate)).slice(0, 18);
  }, [liquidPerpRows]);

  const volumeRows = useMemo(() => {
    return [...markets].filter((m) => (m.quoteVolume24h ?? 0) > 0).sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0)).slice(0, 18);
  }, [markets]);

  const filteredActive = useMemo(() => {
    const rows = [...active].sort((a, b) => b.netEdgePct - a.netEdgePct);
    return query ? rows.filter((p) => p.symbol.includes(query) || baseOf(p.symbol).includes(query)) : rows;
  }, [active, query]);

  const selected = filteredActive.find((p) => p.id === selectedId) ?? filteredActive[0] ?? active[0] ?? null;

  const filteredCandidates = useMemo(() => {
    const source = view === 'funding' ? fundingRows : view === 'volume' ? volumeRows : basisRows;
    return query ? source.filter((m) => m.symbol.includes(query) || m.base.includes(query)) : source;
  }, [basisRows, fundingRows, volumeRows, query, view]);

  const avgAbsBasis = liquidPerpRows.length ? liquidPerpRows.reduce((sum, m) => sum + abs(m.basisPct), 0) / liquidPerpRows.length : 0;
  const aboveThreshold = basisRows.filter((m) => abs(m.basisPct) >= threshold).length;
  const bestBasis = basisRows[0] ?? null;
  const bestFunding = fundingRows[0] ?? null;
  const bestVolume = volumeRows[0] ?? null;
  const modeTone = s?.mode === 'HALTED' ? 'bad' : s?.mode === 'LIVE_ARMED' ? 'ok' : 'warn';

  const reject = async (id: number) => {
    await fetch(`/api/proposals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    if (selectedId === id) setSelectedId(null);
  };

  if (!s) {
    return <div className="container page"><div className="empty-state">Connecting...</div></div>;
  }

  return (
    <div className="container page opportunities-page">
      <section className="opp-hero card">
        <div className="opp-hero-copy">
          <span className="opp-eyebrow">
            <IconRadar size={14} />
            basis scanner
          </span>
          <h1 className="page-title">Opportunities</h1>
          <p>
            A proposal is only a scanner signal. Approving one opens a manual ticket; the risk gate, allowlist,
            typed confirmation, and ledger still control anything live.
          </p>
          <div className="opp-search">
            <IconSearch size={15} />
            <input placeholder="Search symbol or asset" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
          </div>
        </div>
        <div className="opp-hero-panel">
          <span className="opp-orb">
            <IconPulse size={34} />
          </span>
          <b className="num">{active.length}</b>
          <em>active proposals</em>
          <StatePill tone={modeTone}>{s.mode === 'HALTED' ? 'halted' : s.mode === 'LIVE_ARMED' ? 'armed' : 'manual only'}</StatePill>
        </div>
      </section>

      <section className="opp-summary-grid">
        <Metric label="Threshold" value={`${threshold.toFixed(2)}%`} sub={`${s.config.persistTicks} ticks persistence`} />
        <Metric label="Watching" value={s.scanner.watching} sub={`${s.scanner.pairs} exact spot/perp pairs`} />
        <Metric label="Above threshold" value={aboveThreshold} tone={aboveThreshold ? 'up' : ''} sub={`avg |basis| ${fmtBasis(avgAbsBasis, 3)}`} />
        <Metric label="Top volume" value={bestVolume ? fmtMoney(bestVolume.quoteVolume24h) : '-'} sub={bestVolume?.symbol ?? 'waiting for feed'} />
      </section>

      <div className="opp-viewbar card">
        <div className="seg">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'on' : ''} type="button" onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="opp-viewbar-stats">
          <span><b>{filteredActive.length}</b> proposals</span>
          <span><b>{filteredCandidates.length}</b> radar rows</span>
          <span><b>{watchlist.length}</b> watchlisted</span>
        </div>
      </div>

      <div className="opp-layout">
        <main className="opp-main">
          <section className="opp-section-head">
            <div>
              <h2>{view === 'active' ? 'Active proposal queue' : view === 'basis' ? 'Basis radar' : view === 'funding' ? 'Funding radar' : 'Liquidity radar'}</h2>
              <span>
                {view === 'active'
                  ? 'Ranked by net edge after fees — the scanner\'s own number, nothing invented.'
                  : 'Candidate rows are market context, not active proposals. Use detail before approving anything.'}
              </span>
            </div>
            <StatePill tone={active.length ? 'ok' : 'idle'}>{active.length ? 'signals live' : 'standby'}</StatePill>
          </section>

          {view === 'active' ? (
            filteredActive.length > 0 ? (
              <div className="opp-proposal-grid-list">
                {filteredActive.map((p) => (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    market={marketBySymbol.get(p.symbol)}
                    watchlisted={watchlist.includes(p.symbol)}
                    selected={selected?.id === p.id}
                    onSelect={() => setSelectedId(p.id)}
                    onApprove={() => void approveProposal(p.id)}
                    onDetail={() => openDetail(p.symbol)}
                    onWatch={() => void toggleWatch(p.symbol)}
                    onReject={() => void reject(p.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="opp-empty-card card">
                <EmptyState title={query ? 'No proposal matches that search' : 'No active proposals right now'}>
                  The scanner is still working. Nothing gets invented here; use the radar boards below to inspect real
                  Binance basis, funding, and liquidity candidates while waiting for persistence.
                </EmptyState>
              </div>
            )
          ) : (
            <div className="opp-candidate-board card">
              {filteredCandidates.length > 0 ? (
                filteredCandidates.slice(0, 12).map((m) => (
                  <CandidateRow
                    key={`${view}-${m.symbol}`}
                    m={m}
                    kind={view === 'funding' ? 'funding' : view === 'volume' ? 'volume' : 'basis'}
                    threshold={threshold}
                    feesPct={s.config.feesPct}
                    watchlisted={watchlist.includes(m.symbol)}
                    onDetail={() => openDetail(m.symbol)}
                    onWatch={() => void toggleWatch(m.symbol)}
                  />
                ))
              ) : (
                <EmptyState title="No radar rows">
                  The market feed is connected, but this filter has no rows matching the current search.
                </EmptyState>
              )}
            </div>
          )}
        </main>

        <aside className="opp-rail">
          <section className="opp-rail-card card">
            <div className="opp-rail-head">
              <h3>Best live edges</h3>
              <span>real Binance feed</span>
            </div>
            <button className="opp-edge-row" type="button" disabled={!bestBasis} onClick={() => bestBasis && openDetail(bestBasis.symbol)}>
              <IconPercent size={16} />
              <span><b>{bestBasis?.symbol ?? 'No basis row'}</b><em>basis leader</em></span>
              <strong className={signClass(bestBasis?.basisPct)}>{fmtBasis(bestBasis?.basisPct, 2)}</strong>
            </button>
            <button className="opp-edge-row" type="button" disabled={!bestFunding} onClick={() => bestFunding && openDetail(bestFunding.symbol)}>
              <IconPulse size={16} />
              <span><b>{bestFunding?.symbol ?? 'No funding row'}</b><em>funding extreme</em></span>
              <strong className={signClass(bestFunding?.fundingRate)}>{fmtFunding(bestFunding?.fundingRate)}</strong>
            </button>
            <button className="opp-edge-row" type="button" disabled={!bestVolume} onClick={() => bestVolume && openDetail(bestVolume.symbol)}>
              <IconLayers size={16} />
              <span><b>{bestVolume?.symbol ?? 'No volume row'}</b><em>liquidity leader</em></span>
              <strong>{fmtMoney(bestVolume?.quoteVolume24h)}</strong>
            </button>
          </section>

          <section className="opp-rail-card card">
            <div className="opp-rail-head">
              <h3>Execution discipline</h3>
              <span>proposal to order</span>
            </div>
            <div className="opp-check-list">
              <div><IconRadar size={15} /><span><b>Scanner only</b><em>proposal opens after persistence</em></span></div>
              <div><IconTicket size={15} /><span><b>Manual ticket</b><em>approve only prefills the spot leg</em></span></div>
              <div><IconShield size={15} /><span><b>Risk gate</b><em>limits and allowlist re-check server-side</em></span></div>
              <div><IconBook size={15} /><span><b>Ledger</b><em>approve, reject, risk, and order actions are recorded</em></span></div>
            </div>
            <button className="cta-pill" type="button" onClick={() => setPage('risk')}>Open risk controls</button>
          </section>

          {selected && (
            <section className="opp-rail-card card">
              <div className="opp-rail-head">
                <h3>Selected brief</h3>
                <span>{selected.symbol}</span>
              </div>
              <div className="opp-selected-token">
                <TokenIcon symbol={selected.symbol} size={38} />
                <span><b>{baseOf(selected.symbol)}</b><em>{SIDE_LABEL[selected.side]}</em></span>
              </div>
              <div className="opp-selected-grid">
                <Metric label="Spot" value={fmtPrice(selected.spotPrice)} />
                <Metric label="Perp mark" value={fmtPrice(selected.perpMark)} />
                <Metric label="Confidence" value={`${Math.round(selected.confidence * 100)}%`} />
                <Metric label="Borrow" value={selected.side === 'LONG_PERP_SHORT_SPOT' ? 'Required' : 'None'} />
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
