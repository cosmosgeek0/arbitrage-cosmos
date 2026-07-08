/* Basis Scanner — what the engine is scanning and why, in the Markets voice.
   Blueprint skeleton: pipeline stats, the live board (spot/perp quotes,
   executable gap, net after fees, funding + countdown, depth, status, the
   engine's own reject/watch reasoning), open proposals, funding extremes.
   Every number comes from the server; nothing is scored client-side. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { Pill, type Tone } from '../components/px';
import { Num } from '../components/Num';
import { baseOf, fmtFunding, fmtMoney, fmtPct, fmtPrice, signClass, timeAgo } from '../format';
import { tokenName } from '../lib/tokenNames';
import type { MarketRow, Proposal, SignalRecord } from '../types';
import './Markets.css';

type FundingExtremes = { positive: MarketRow[]; negative: MarketRow[] };
type SortKey = 'basis' | 'net' | 'funding' | 'volume' | 'status';

const SIDE_SHORT: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Carry Setup',
  LONG_PERP_SHORT_SPOT: 'Borrow Setup',
};

const STATUS_RANK: Record<MarketRow['status'], number> = { signal: 2, watching: 1, idle: 0 };
const STATUS_TONE: Record<MarketRow['status'], Tone> = { signal: 'ok', watching: 'warn', idle: 'idle' };
const STATUS_LABEL: Record<MarketRow['status'], string> = { signal: 'Signal', watching: 'Watching', idle: 'Idle' };

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function abs(v: number | null | undefined): number {
  return finite(v) ? Math.abs(v) : 0;
}

/** Same arithmetic the scanner uses: gross |basis| minus round-trip fees. */
function netAfterFees(m: MarketRow, feesPct: number): number | null {
  if (!finite(m.basisPct)) return null;
  return Math.abs(m.basisPct) - feesPct;
}

function fmtCountdown(ts: number | null | undefined): string {
  if (!ts) return '—';
  const ms = ts - Date.now();
  if (ms <= 0) return 'Due';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `In ${m}m`;
  return `In ${Math.floor(m / 60)}h ${m % 60}m`;
}

export function Strategies() {
  const { state, markets, setPage, openDetail } = useStore();
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [extremes, setExtremes] = useState<FundingExtremes | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    void fetch('/api/signals')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHistory((d as { recent: SignalRecord[] }).recent))
      .catch(() => undefined);
  }, [state?.proposals.length]);

  useEffect(() => {
    const load = () =>
      fetch('/api/funding/extremes')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setExtremes(d as FundingExtremes))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 15_000);
    return () => window.clearInterval(t);
  }, []);

  const s = state;
  const threshold = s?.scanner.grossThresholdPct ?? 0;
  const feesPct = s?.config.feesPct ?? 0;
  const minNet = s?.config.minNetBasisPct ?? 0;
  const minVolume = s?.config.minQuoteVolume24h ?? 0;
  const persistTicks = s?.config.persistTicks ?? 0;
  const proposals = s?.proposals ?? [];

  const liquidPerps = useMemo(
    () => markets.filter((m) => m.hasPerp && (m.quoteVolume24h ?? 0) >= minVolume),
    [markets, minVolume],
  );

  const board = useMemo(() => {
    const rows = liquidPerps.filter((m) => finite(m.basisPct));
    const dir = sortDesc ? -1 : 1;
    return [...rows]
      .sort((a, b) => {
        switch (sortKey) {
          case 'basis': return (abs(a.basisPct) - abs(b.basisPct)) * dir;
          case 'net': return ((netAfterFees(a, feesPct) ?? -1) - (netAfterFees(b, feesPct) ?? -1)) * dir;
          case 'funding': return (abs(a.fundingRate) - abs(b.fundingRate)) * dir;
          case 'volume': return ((a.quoteVolume24h ?? 0) - (b.quoteVolume24h ?? 0)) * dir;
          case 'status': return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir || abs(b.basisPct) - abs(a.basisPct);
        }
      })
      .slice(0, 25);
  }, [liquidPerps, sortKey, sortDesc, feesPct]);

  const watchingRows = liquidPerps.filter((m) => m.status === 'watching').length;
  const scannerFresh = s?.scanner.lastTickTs ? Date.now() - s.scanner.lastTickTs < 45_000 : false;

  const fundingFallback = useMemo(
    () =>
      [...liquidPerps]
        .filter((m) => finite(m.fundingRate))
        .sort((a, b) => abs(b.fundingRate) - abs(a.fundingRate)),
    [liquidPerps],
  );
  const positiveFunding = (extremes?.positive.length ? extremes.positive : fundingFallback.filter((m) => (m.fundingRate ?? 0) > 0)).slice(0, 4);
  const negativeFunding = (extremes?.negative.length ? extremes.negative : fundingFallback.filter((m) => (m.fundingRate ?? 0) < 0)).slice(0, 4);

  const rankedProposals = useMemo(() => [...proposals].sort((a, b) => b.netEdgePct - a.netEdgePct), [proposals]);
  const recentSignals = useMemo(() => history.slice(0, 6), [history]);

  const SortHead = ({ label, k, right = true }: { label: string; k: SortKey; right?: boolean }) => (
    <th className={right ? 'r' : 'l'} aria-sort={sortKey === k ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
      <button className="acb-sort" type="button" onClick={() => { if (sortKey === k) setSortDesc((v) => !v); else { setSortKey(k); setSortDesc(true); } }}>
        {label}
        <i>{sortKey === k ? (sortDesc ? '▾' : '▴') : ''}</i>
      </button>
    </th>
  );

  return (
    <div className="container page mkx bsx-page">
      {/* ---- hero: the pipeline truth ------------------------------------- */}
      <header className="bwx-hero bsx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>Basis Scanner</h1>
              <Pill tone={!s ? 'idle' : scannerFresh ? 'ok' : 'bad'}>{!s ? 'Connecting' : scannerFresh ? `Scanning · Tick ${s.scanner.lastTickTs ? timeAgo(s.scanner.lastTickTs) : '—'}` : 'Stale Feed'}</Pill>
            </div>
            <p>The Spot/Perp Basis Engine — It Proposes, Never Trades · Gate = Fees {fmtPct(feesPct, 2, false)} + Min Net {fmtPct(minNet, 2, false)} Held {persistTicks}+ Ticks</p>
          </div>
        </div>
        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Pairs Scanned</em>
            <b>{s?.scanner.pairs ?? '—'}</b>
            <small>Exact Spot + Perp Listings</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Pass Liquidity</em>
            <b>{liquidPerps.length}</b>
            <small>≥ {fmtMoney(minVolume)} 24h Volume</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Watching</em>
            <b>{watchingRows}</b>
            <small>|Basis| Above The {threshold.toFixed(2)}% Gate</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Proposing</em>
            <b>{rankedProposals.length}</b>
            <small>Persisted {persistTicks}+ Ticks</small>
          </div>
        </div>
      </header>

      {/* ---- open proposals ------------------------------------------------ */}
      <section className="rsx-band">
        <div className="bsx-props-head">
          <h2>Open Proposals <em>{rankedProposals.length ? `${rankedProposals.length} Open · Ranked By Net Edge` : 'None Open'}</em></h2>
          <button type="button" className="mkx-pill" onClick={() => setPage('opportunities')}>Open Queue</button>
        </div>
        {rankedProposals.length > 0 ? (
          <div className="bsx-props">
            {rankedProposals.map((p) => (
              <button key={p.id} type="button" className="bsx-prop" onClick={() => setPage('opportunities')}>
                <TokenIcon symbol={p.symbol} size={34} />
                <span className="bsx-prop-main">
                  <b>{baseOf(p.symbol)} <Pill tone={p.side === 'SHORT_PERP_LONG_SPOT' ? 'ok' : 'warn'}>{SIDE_SHORT[p.side]}</Pill></b>
                  <em title={p.reason}>{p.reason}</em>
                </span>
                <span className={`bsx-prop-edge ${signClass(p.netEdgePct)}`}>
                  <Num value={p.netEdgePct}>{fmtPct(p.netEdgePct, 2)}</Num>
                  <small>Net Edge</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="tdx-dimnote">
            {scannerFresh
              ? `No basis gap has held above ${threshold.toFixed(2)}% for ${persistTicks} ticks. The board below shows how close the market is.`
              : 'The market feed looks stale, so the scanner cannot judge anything right now.'}
          </p>
        )}
      </section>

      {/* ---- the live board ------------------------------------------------ */}
      <section className="rsx-band">
        <div className="bwx-market-head">
          <h2>Scanner Board <em>Top {board.length} Of {liquidPerps.length} Liquid Pairs</em></h2>
        </div>
        <table className="acb-table bsx-table">
          <thead>
            <tr>
              <SortHead label="Asset" k="status" right={false} />
              <th className="r">Spot</th>
              <th className="r">Perp</th>
              <SortHead label="Basis" k="basis" />
              <SortHead label="Net After Fees" k="net" />
              <SortHead label="Funding" k="funding" />
              <SortHead label="24h Volume" k="volume" />
              <th className="r">Status</th>
            </tr>
          </thead>
          <tbody>
            {board.map((m) => {
              const net = netAfterFees(m, feesPct);
              return (
                <tr key={m.symbol} className="link" onClick={() => openDetail(m.symbol)}>
                  <td className="l acb-asset">
                    <TokenIcon symbol={m.symbol} size={36} />
                    <span className="acb-asset-name">
                      <b>{m.base}</b>
                      <em>{tokenName(m.base)}</em>
                    </span>
                  </td>
                  <td className="r acb-num">
                    <span className="acb-cell-main">{m.spot !== null ? fmtPrice(m.spot) : '—'}</span>
                    <span className="bsx-cell-sub">{finite(m.spotSpreadPct) ? `Spread ${fmtPct(m.spotSpreadPct, 3, false)}` : '—'}</span>
                  </td>
                  <td className="r acb-num">
                    <span className="acb-cell-main">{m.perpMark !== null ? fmtPrice(m.perpMark) : '—'}</span>
                    <span className="bsx-cell-sub">{finite(m.perpIndexPrice) ? `Index ${fmtPrice(m.perpIndexPrice)}` : '—'}</span>
                  </td>
                  <td className="r acb-num">
                    <span className={`acb-cell-main ${signClass(m.basisPct)}`}>{finite(m.basisPct) ? fmtPct(m.basisPct, 3) : '—'}</span>
                    <span className="bsx-cell-sub">{finite(m.basisPct) ? (m.basisPct > 0 ? 'Perp Rich' : 'Perp Cheap') : ''}</span>
                  </td>
                  <td className="r acb-num">
                    <span className={`acb-cell-main ${net !== null && net >= minNet ? 'up' : ''}`}>{net !== null ? fmtPct(net, 3, false) : '—'}</span>
                    <span className="bsx-cell-sub">Gate {fmtPct(minNet, 2, false)}</span>
                  </td>
                  <td className="r acb-num">
                    <span className={`acb-cell-main ${signClass(m.fundingRate)}`}>{finite(m.fundingRate) ? fmtFunding(m.fundingRate) : '—'}</span>
                    <span className="bsx-cell-sub">{fmtCountdown(m.nextFundingTime)}</span>
                  </td>
                  <td className="r acb-num"><span className="acb-cell-main">{fmtMoney(m.quoteVolume24h ?? 0)}</span></td>
                  <td className="r"><Pill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---- funding extremes + recent signals ----------------------------- */}
      <section className="rsx-band">
        <div className="rsx-cols">
          <div className="rsx-col">
            <h3>Funding Extremes</h3>
            <div className="bsx-fund-cols">
              <div>
                <em className="bsx-fund-label">Longs Pay Most</em>
                {positiveFunding.map((m) => (
                  <button key={m.symbol} type="button" className="bsx-fund-row" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={26} />
                    <b>{m.base}</b>
                    <span className="up">{fmtFunding(m.fundingRate)}</span>
                  </button>
                ))}
                {!positiveFunding.length && <p className="tdx-dimnote">None Positive Right Now.</p>}
              </div>
              <div>
                <em className="bsx-fund-label">Shorts Pay Most</em>
                {negativeFunding.map((m) => (
                  <button key={m.symbol} type="button" className="bsx-fund-row" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={26} />
                    <b>{m.base}</b>
                    <span className="down">{fmtFunding(m.fundingRate)}</span>
                  </button>
                ))}
                {!negativeFunding.length && <p className="tdx-dimnote">None Negative Right Now.</p>}
              </div>
            </div>
          </div>
          <div className="rsx-col">
            <h3>Recent Signals</h3>
            {recentSignals.length ? (
              <div className="bwx-feed">
                {recentSignals.map((sig) => (
                  <div key={sig.id} className="bwx-feed-row">
                    <TokenIcon symbol={sig.symbol} size={26} />
                    <span className="bwx-feed-label">
                      <b>{baseOf(sig.symbol)} · Opened {fmtPct(sig.basisOpen, 2)} · Peak {fmtPct(sig.basisPeak, 2)}</b>
                      <em>{sig.closedTs ? `Closed ${fmtPct(sig.basisClose ?? 0, 2)} · ${timeAgo(sig.closedTs)}` : 'Still Open'}</em>
                    </span>
                    <span className="bwx-feed-time">{timeAgo(sig.openedTs)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tdx-dimnote">No signals recorded yet — the ledger fills as gates trip.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
