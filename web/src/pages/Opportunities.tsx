/* Opportunities is the proposal queue: every row is a real scanner signal
   with the engine's own numbers — nothing is scored or ranked by invented
   client-side formulas. Radar tabs are labeled market context, not signals. */
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { SparkArea, Sparkline } from '../components/Spark';
import { Dot, Empty, PageHead, Pill, Seg, type Tone } from '../components/px';
import { IconRadar } from '../components/Icons';
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
  { id: 'active', label: 'Proposals' },
  { id: 'basis', label: 'Basis' },
  { id: 'funding', label: 'Funding' },
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

/** Same arithmetic the scanner uses: gross |basis| minus round-trip fees. */
function netAfterFees(m: MarketRow, feesPct: number): number | null {
  if (!finite(m.basisPct)) return null;
  return abs(m.basisPct) - feesPct;
}

function displayReason(reason: string, borrow: string | null): string {
  const cleanedReason = reason
    .replace(/\|basis\|/gi, 'basis')
    .replace(/24h spot vol/gi, '24h spot volume')
    .replace(/\s+/g, ' ')
    .trim();

  if (!borrow) return cleanedReason;

  const cleanedBorrow = borrow
    .replace(/availability NOT checked in v0/gi, 'availability pending')
    .replace(/\s*—\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleanedReason} · ${cleanedBorrow}`;
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
  const modeTone: Tone = s?.mode === 'HALTED' ? 'bad' : s?.mode === 'LIVE_ARMED' ? 'ok' : 'warn';
  const candidateKind: CandidateKind = view === 'funding' ? 'funding' : view === 'volume' ? 'volume' : 'basis';

  const reject = async (id: number) => {
    await fetch(`/api/proposals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    if (selectedId === id) setSelectedId(null);
  };

  if (!s) {
    return (
      <div className="container page hp-page">
        <PageHead mark={<IconRadar size={18} />} tone="idle" title="Opportunities" sub="The proposal queue — where scanner signals become inspectable action." />
        <div className="hp-loading">
          <Pill tone="idle">Connecting</Pill>
          <b>Waiting for server state…</b>
        </div>
      </div>
    );
  }

  return (
    <div className="container page mkx opx-page">
      <header className="bwx-hero opx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>Opportunities</h1>
              <Pill tone={modeTone}>{s.mode === 'HALTED' ? 'Halted' : s.mode === 'LIVE_ARMED' ? 'Live Armed' : 'Manual Only'}</Pill>
            </div>
            <p>Proposal queue · Scanner signals · Engine net edge</p>
          </div>
        </div>
        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Active</em>
            <b>{active.length}</b>
            <small>Net edge after fees</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Gate</em>
            <b>{threshold.toFixed(2)}%</b>
            <small>{s.config.persistTicks} ticks required</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Above Gate</em>
            <b>{aboveThreshold}</b>
            <small>Avg |Basis| {fmtBasis(avgAbsBasis, 3)}</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Pairs</em>
            <b>{s.scanner.watching}</b>
            <small>{s.scanner.pairs} exact spot/perp</small>
          </div>
        </div>
      </header>

      <div className="lg-filters">
        <Seg value={view} options={VIEWS} onChange={setView} />
        <input
          className="hp-input lg-search"
          placeholder="Search symbol or asset"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        <span className="lg-filter-gap" />
        <span className="pnl-lens-note">
          {view === 'active'
            ? 'engine numbers only'
            : 'market context only'}
        </span>
      </div>

      <div className="lg-grid exec-grid">
        <main className="opp-main">
          {view === 'active' ? (
            filteredActive.length > 0 ? (
              <div className="opp-list">
                {filteredActive.map((p) => {
                  const borrowRequired = p.side === 'LONG_PERP_SHORT_SPOT';
                  const market = marketBySymbol.get(p.symbol);
                  const watching = watchlist.includes(p.symbol);
                  return (
                    <article
                      key={p.id}
                      className={`hp-group opp-card${selected?.id === p.id ? ' selected' : ''}`}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <div className="opp-card-head">
                        <span className="exec-sym">
                          <TokenIcon symbol={p.symbol} size={18} />
                          <b>{baseOf(p.symbol)}</b>
                          <em>{SIDE_LABEL[p.side]}</em>
                        </span>
                        <Pill tone={borrowRequired ? 'warn' : 'ok'}>{SIDE_SHORT[p.side]}</Pill>
                        <span className="opp-edge">
                          <span>net edge</span>
                          <b className={`num ${signClass(p.netEdgePct)}`}>{fmtPct(p.netEdgePct, 2)}</b>
                        </span>
                      </div>
                      <div className="opp-card-spark">
                        <SparkArea values={market?.spark ?? []} color={brandColor(p.symbol)} />
                      </div>
                      <dl className="opp-card-facts">
                        <div><dt>Basis now / peak</dt><dd className={signClass(p.basisNow)}>{fmtBasis(p.basisNow, 2)} / {fmtBasis(p.basisPeak, 2)}</dd></div>
                        <div><dt>Funding</dt><dd className={signClass(p.fundingRate)}>{fmtFunding(p.fundingRate)}</dd></div>
                        <div><dt>Confidence</dt><dd>{Math.round(p.confidence * 100)}%</dd></div>
                        <div><dt>24h volume</dt><dd>{fmtMoney(p.quoteVolume24h)}</dd></div>
                        <div><dt>Fees</dt><dd>{fmtPct(p.feesPct, 2, false)}</dd></div>
                        <div><dt>Opened</dt><dd>{timeAgo(p.openedTs)}</dd></div>
                      </dl>
                      <p className="opp-card-reason" title={p.reason}>
                        {displayReason(p.reason, borrowRequired ? p.borrow : null)}
                      </p>
                      <div className="opp-card-actions">
                        <button className="hp-btn primary" type="button" onClick={(e) => { e.stopPropagation(); void approveProposal(p.id); }}>
                          Approve ticket
                        </button>
                        <button className="hp-btn" type="button" onClick={(e) => { e.stopPropagation(); openDetail(p.symbol); }}>
                          Market
                        </button>
                        <button className={`hp-btn${watching ? ' lg-toggle active' : ''}`} type="button" onClick={(e) => { e.stopPropagation(); void toggleWatch(p.symbol); }}>
                          {watching ? 'Watching' : 'Watch'}
                        </button>
                        <button className="hp-btn danger" type="button" title="Dismiss this proposal and ledger the action" onClick={(e) => { e.stopPropagation(); void reject(p.id); }}>
                          Reject
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty title={query ? 'No proposal matches that search' : 'No active proposals right now'}>
                The scanner opens proposals only after threshold and persistence are met. Use the radar views for live market context while waiting.
              </Empty>
            )
          ) : (
            <section className="hp-group lg-feed">
              <div className="lg-feed-head">
                <h3>{view === 'basis' ? 'Basis radar' : view === 'funding' ? 'Funding radar' : 'Liquidity radar'}</h3>
                <span>{filteredCandidates.length} rows · context only</span>
              </div>
              {filteredCandidates.length === 0 ? (
                <div className="lg-empty-pad">
                  <Empty title="No radar rows">The market feed is connected, but this filter has no rows matching the current search.</Empty>
                </div>
              ) : (
                <div className="hp-table-wrap">
                  <table className="hp-table exec-table">
                    <colgroup>
                      <col style={{ width: 130 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 130 }} />
                      <col />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 150 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Trend</th>
                        <th className="num-r">{candidateKind === 'funding' ? 'Funding' : candidateKind === 'volume' ? '24h volume' : 'Basis'}</th>
                        <th>Setup</th>
                        <th>Context</th>
                        <th className="num-r">Net of fees</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCandidates.slice(0, 12).map((m) => {
                        const side = sideForBasis(m.basisPct);
                        const net = netAfterFees(m, s.config.feesPct);
                        const mainMetric = candidateKind === 'funding' ? fmtFunding(m.fundingRate) : candidateKind === 'volume' ? fmtMoney(m.quoteVolume24h) : fmtBasis(m.basisPct, 2);
                        const tone = candidateKind === 'funding' ? signClass(m.fundingRate) : candidateKind === 'volume' ? '' : signClass(m.basisPct);
                        const watching = watchlist.includes(m.symbol);
                        return (
                          <tr key={`${view}-${m.symbol}`} onClick={() => openDetail(m.symbol)}>
                            <td className="t-source">
                              <span className="exec-sym">
                                <TokenIcon symbol={m.symbol} size={16} />
                                {m.base}
                              </span>
                            </td>
                            <td><Sparkline values={m.spark} color={brandColor(m.symbol)} /></td>
                            <td className={`t-value num-r ${tone}`}>{mainMetric}</td>
                            <td className="t-layer">{SIDE_SHORT[side]}</td>
                            <td className="t-detail">
                              {candidateKind === 'basis'
                                ? `${fmtPct(abs(m.basisPct) - threshold, 2)} vs threshold`
                                : `${fmtBasis(m.basisPct, 2)} basis · ${fmtMoney(m.quoteVolume24h)} vol`}
                            </td>
                            <td className={`t-value num-r ${net !== null && net >= threshold - s.config.feesPct ? 'up' : ''}`}>
                              {net !== null ? fmtPct(net, 2) : '—'}
                            </td>
                            <td>
                              <span className="exec-row-actions">
                                <button className="hp-btn exec-cancel" type="button" onClick={(e) => { e.stopPropagation(); openDetail(m.symbol); }}>Open</button>
                                <button className={`hp-btn exec-cancel${watching ? ' lg-toggle active' : ''}`} type="button" onClick={(e) => { e.stopPropagation(); void toggleWatch(m.symbol); }}>
                                  {watching ? 'Watching' : 'Watch'}
                                </button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </main>

        <aside className="lg-facets">
          <section className="hp-group lg-facet">
            <h3>Best live edges</h3>
            {[
              { m: basisRows[0], label: 'basis', value: basisRows[0] ? fmtBasis(basisRows[0].basisPct, 2) : '—', tone: signClass(basisRows[0]?.basisPct) },
              { m: fundingRows[0], label: 'funding', value: fundingRows[0] ? fmtFunding(fundingRows[0].fundingRate) : '—', tone: signClass(fundingRows[0]?.fundingRate) },
              { m: volumeRows[0], label: 'liquidity', value: volumeRows[0] ? fmtMoney(volumeRows[0].quoteVolume24h) : '—', tone: '' },
            ].map((row) => (
              <button key={row.label} type="button" disabled={!row.m} onClick={() => row.m && openDetail(row.m.symbol)}>
                <span>{row.m?.symbol ?? '—'} · {row.label}</span>
                <b className={row.tone}>{row.value}</b>
              </button>
            ))}
          </section>

          {selected && (
            <section className="hp-group lg-inspect opp-brief-card">
              <div className="lg-inspect-head">
                <Pill tone={selected.side === 'LONG_PERP_SHORT_SPOT' ? 'warn' : 'ok'}>{SIDE_SHORT[selected.side]}</Pill>
                <h3>{baseOf(selected.symbol)} signal</h3>
                <span>{SIDE_LABEL[selected.side]}</span>
              </div>
              <dl className="lg-facts">
                <div><dt>Spot</dt><dd className="num">{fmtPrice(selected.spotPrice)}</dd></div>
                <div><dt>Perp mark</dt><dd className="num">{fmtPrice(selected.perpMark)}</dd></div>
                <div><dt>Net edge</dt><dd className={`num ${signClass(selected.netEdgePct)}`}>{fmtPct(selected.netEdgePct, 2)}</dd></div>
                <div><dt>Confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div>
                <div><dt>Borrow</dt><dd>{selected.side === 'LONG_PERP_SHORT_SPOT' ? 'Required' : 'None'}</dd></div>
              </dl>
              <div className="lg-related">
                <button className="hp-btn" type="button" onClick={() => setPage('risk')}>Open risk controls</button>
              </div>
            </section>
          )}
        </aside>
      </div>

    </div>
  );
}
