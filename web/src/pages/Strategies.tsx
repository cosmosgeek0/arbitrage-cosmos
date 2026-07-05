/* Strategies shows the ONE real strategy (the basis scanner) as an instrument:
   the pipeline it runs (pairs → liquidity → watching → proposing), the symbols
   it is watching and why, the proposals it opened with the engine's own reason,
   and what happened to past signals. Every number on this page comes from the
   server; nothing is scored or invented client-side. Funding/liquidity are
   labeled context lenses, not strategies. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { TokenIcon, brandColor } from '../components/TokenIcon';
import { SparkArea, Sparkline } from '../components/Spark';
import { EmptyState, StatePill } from '../components/ui';
import { Num } from '../components/Num';
import {
  IconBook,
  IconBrain,
  IconChart,
  IconCoins,
  IconPulse,
  IconRadar,
  IconShield,
} from '../components/Icons';
import { baseOf, duration, fmtBasis, fmtDateTime, fmtFunding, fmtMoney, fmtPct, signClass, timeAgo } from '../format';
import type { MarketRow, Proposal, SignalRecord } from '../types';

type FundingExtremes = { positive: MarketRow[]; negative: MarketRow[] };

const SIDE_LABEL: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp / long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp / short spot',
};

const SIDE_SHORT: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Carry setup',
  LONG_PERP_SHORT_SPOT: 'Borrow setup',
};

const STATUS_RANK: Record<MarketRow['status'], number> = { signal: 2, watching: 1, idle: 0 };

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

function fmtCountdown(ts: number | null): string {
  if (!ts) return '—';
  const ms = ts - Date.now();
  if (ms <= 0) return 'due';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  return `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusPill(status: MarketRow['status']): ReactNode {
  if (status === 'signal') return <StatePill tone="ok">signal</StatePill>;
  if (status === 'watching') return <StatePill tone="warn">watching</StatePill>;
  return <StatePill tone="idle">idle</StatePill>;
}

function PipelineStage({ label, value, gate, hot }: { label: string; value: ReactNode; gate: string; hot?: boolean }) {
  return (
    <div className={`strategy-stage ${hot ? 'hot' : ''}`}>
      <b className="num">{value}</b>
      <span>{label}</span>
      <em>{gate}</em>
    </div>
  );
}

function ProposalCard({
  p,
  market,
  onQueue,
  onDetail,
}: {
  p: Proposal;
  market?: MarketRow;
  onQueue: () => void;
  onDetail: () => void;
}) {
  return (
    <article className="strategy-proposal card">
      <header className="strategy-proposal-head">
        <TokenIcon symbol={p.symbol} size={38} />
        <div className="strategy-proposal-id">
          <b>{baseOf(p.symbol)}</b>
          <em>{p.symbol} · opened {timeAgo(p.openedTs)}</em>
        </div>
        <span className={`chip-tag ${p.side === 'SHORT_PERP_LONG_SPOT' ? 'ok' : 'purple'}`}>{SIDE_SHORT[p.side]}</span>
        <div className="strategy-proposal-edge">
          <em>net edge</em>
          <Num value={p.netEdgePct} className={`strategy-edge-num ${signClass(p.netEdgePct)}`}>{fmtPct(p.netEdgePct, 2)}</Num>
        </div>
      </header>
      <p className="strategy-proposal-reason">{p.reason}</p>
      <div className="strategy-proposal-facts">
        <div><em>Basis now → peak</em><b className={`num ${signClass(p.basisNow)}`}>{fmtBasis(p.basisNow, 2)} → {fmtBasis(p.basisPeak, 2)}</b></div>
        <div><em>Funding</em><b className={`num ${signClass(p.fundingRate)}`}>{fmtFunding(p.fundingRate)}</b></div>
        <div><em>Confidence</em><b className="num">{Math.round(p.confidence * 100)}%</b></div>
        <div><em>Borrow</em><b className={p.side === 'LONG_PERP_SHORT_SPOT' ? 'warn-text' : ''}>{p.borrow}</b></div>
      </div>
      <div className="strategy-proposal-spark">
        <SparkArea values={market?.spark ?? []} color={brandColor(p.symbol)} />
        <em>spot trend</em>
      </div>
      <footer className="strategy-proposal-actions">
        <button className="cta-pill" type="button" onClick={onQueue}>Open in queue</button>
        <button className="mini-btn" type="button" onClick={onDetail}>
          <IconChart size={14} />
          Market
        </button>
      </footer>
    </article>
  );
}

export function Strategies() {
  const { state, markets, setPage, openDetail } = useStore();
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [extremes, setExtremes] = useState<FundingExtremes | null>(null);

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
  const marketBySymbol = useMemo(() => new Map(markets.map((m) => [m.symbol, m])), [markets]);

  const liquidPerps = useMemo(
    () => markets.filter((m) => m.hasPerp && (m.quoteVolume24h ?? 0) >= minVolume),
    [markets, minVolume]
  );

  // What the scanner is looking at, in its own order: live signals first,
  // then symbols it is actively watching, then the closest idle candidates.
  const board = useMemo(
    () =>
      [...liquidPerps]
        .filter((m) => finite(m.basisPct))
        .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || abs(b.basisPct) - abs(a.basisPct))
        .slice(0, 10),
    [liquidPerps]
  );

  // One source of truth for "watching" everywhere on this page: the same
  // market rows whose status pills are visible on the board below.
  const watchingRows = liquidPerps.filter((m) => m.status === 'watching').length;
  const scannerFresh = s?.scanner.lastTickTs ? Date.now() - s.scanner.lastTickTs < 45_000 : false;

  const fundingFallback = useMemo(
    () =>
      [...liquidPerps]
        .filter((m) => finite(m.fundingRate))
        .sort((a, b) => abs(b.fundingRate) - abs(a.fundingRate)),
    [liquidPerps]
  );
  const positiveFunding = (extremes?.positive.length ? extremes.positive : fundingFallback.filter((m) => (m.fundingRate ?? 0) > 0)).slice(0, 3);
  const negativeFunding = (extremes?.negative.length ? extremes.negative : fundingFallback.filter((m) => (m.fundingRate ?? 0) < 0)).slice(0, 3);

  const rankedProposals = useMemo(() => [...proposals].sort((a, b) => b.netEdgePct - a.netEdgePct), [proposals]);

  if (!s) {
    return <div className="container page"><div className="empty-state">Connecting...</div></div>;
  }

  return (
    <div className="container page strategies-page">
      <section className="strategy-hero card">
        <div className="strategy-hero-copy">
          <span className="strategy-eyebrow">
            <IconBrain size={15} />
            basis engine · monitor only
          </span>
          <h1 className="page-title">Strategies</h1>
          <p>
            One strategy runs today: the spot/perp basis scanner. It proposes, never trades — every order still passes
            manual review, the risk gate, allowlist, and typed confirmation, and everything lands in the ledger.
          </p>
          <div className="strategy-hero-actions">
            <button className="cta-pill" type="button" onClick={() => setPage('opportunities')}>
              <IconRadar size={14} />
              Open proposal queue
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
              <IconShield size={14} />
              Risk controls
            </button>
          </div>
        </div>

        <div className="strategy-pipeline">
          <div className="strategy-pipeline-head">
            <b>Scanner pipeline</b>
            <StatePill tone={scannerFresh ? 'ok' : 'bad'}>{scannerFresh ? 'scanning' : 'stale feed'}</StatePill>
          </div>
          <div className="strategy-stages">
            <PipelineStage label="pairs scanned" value={s.scanner.pairs} gate="exact spot + perp listings" />
            <PipelineStage label="pass liquidity" value={liquidPerps.length} gate={`≥ ${fmtMoney(minVolume)} 24h volume`} />
            <PipelineStage label="watching" value={watchingRows} gate={`|basis| above ${threshold.toFixed(2)}% gate`} hot={watchingRows > 0} />
            <PipelineStage label="proposing" value={rankedProposals.length} gate={`persisted ${persistTicks}+ ticks`} hot={rankedProposals.length > 0} />
          </div>
          <div className="strategy-pipeline-foot">
            <span>tick {s.scanner.lastTickTs ? timeAgo(s.scanner.lastTickTs) : '—'}</span>
            <span>gate = fees {fmtPct(feesPct, 2, false)} + min net {fmtPct(minNet, 2, false)}</span>
            <button type="button" onClick={() => setPage('ledger')}>
              {s.risk.rejectionsToday} risk rejection{s.risk.rejectionsToday === 1 ? '' : 's'} today
            </button>
          </div>
        </div>
      </section>

      <div className="strategy-layout">
        <main className="strategy-main">
          <section className="strategy-section">
            <div className="strategy-section-head">
              <div>
                <h2>Open proposals</h2>
                <span>The scanner's own explanation, verbatim from the ledger. Ranked by net edge after fees.</span>
              </div>
              <StatePill tone={rankedProposals.length ? 'ok' : 'idle'}>{rankedProposals.length ? `${rankedProposals.length} open` : 'none open'}</StatePill>
            </div>
            {rankedProposals.length > 0 ? (
              <div className="strategy-proposal-list">
                {rankedProposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    market={marketBySymbol.get(p.symbol)}
                    onQueue={() => setPage('opportunities')}
                    onDetail={() => openDetail(p.symbol)}
                  />
                ))}
              </div>
            ) : (
              <div className="strategy-empty card">
                <EmptyState title="No open proposals">
                  {scannerFresh
                    ? `No basis gap has held above ${threshold.toFixed(2)}% for ${persistTicks} ticks. The board below shows how close the market is.`
                    : 'The market feed looks stale, so the scanner cannot judge anything right now.'}
                </EmptyState>
              </div>
            )}
          </section>

          <section className="strategy-section">
            <div className="strategy-section-head">
              <div>
                <h2>Scanner board</h2>
                <span>
                  {watchingRows > 0
                    ? `${watchingRows} symbol${watchingRows === 1 ? ' is' : 's are'} inside the gate and building persistence.`
                    : 'Nothing is inside the gate right now — these are the closest liquid pairs.'}
                </span>
              </div>
            </div>
            <div className="strategy-board card">
              <div className="strategy-board-row head">
                <span>Pair</span>
                <span className="t-right">Trend</span>
                <span className="t-right">Basis</span>
                <span className="t-right">Net of fees</span>
                <span className="t-right">Funding</span>
                <span className="t-right">24h volume</span>
                <span className="t-right">Scanner</span>
              </div>
              {board.map((m) => {
                const net = netAfterFees(m, feesPct);
                return (
                  <button key={m.symbol} className="strategy-board-row" type="button" onClick={() => openDetail(m.symbol)}>
                    <span className="strategy-board-pair">
                      <TokenIcon symbol={m.symbol} size={28} />
                      <span><b>{m.base}</b><em>{m.symbol}</em></span>
                    </span>
                    <span className="strategy-board-spark"><Sparkline values={m.spark} color={brandColor(m.symbol)} /></span>
                    <Num value={m.basisPct} className={`t-right ${signClass(m.basisPct)}`}>{fmtBasis(m.basisPct, 2)}</Num>
                    <Num value={net} className={`t-right ${net !== null && net >= minNet ? 'up' : ''}`}>{net !== null ? fmtPct(net, 2) : '—'}</Num>
                    <span className={`t-right num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</span>
                    <span className="t-right num">{fmtMoney(m.quoteVolume24h)}</span>
                    <span className="t-right">{statusPill(m.status)}</span>
                  </button>
                );
              })}
              {board.length === 0 && (
                <EmptyState title="No liquid pairs yet">
                  Waiting for the market feed to fill the spot/perp universe.
                </EmptyState>
              )}
            </div>
          </section>
        </main>

        <aside className="strategy-rail">
          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Funding lens</h3>
              <span>context, not a strategy</span>
            </div>
            <div className="strategy-lens-group">
              <em className="strategy-lens-label">shorts get paid</em>
              {positiveFunding.map((m) => (
                <button key={m.symbol} className="strategy-lens-row" type="button" onClick={() => openDetail(m.symbol)}>
                  <TokenIcon symbol={m.symbol} size={26} />
                  <span><b>{m.base}</b><em>next {fmtCountdown(m.nextFundingTime)}</em></span>
                  <b className={`num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</b>
                </button>
              ))}
              <em className="strategy-lens-label">longs get paid</em>
              {negativeFunding.map((m) => (
                <button key={m.symbol} className="strategy-lens-row" type="button" onClick={() => openDetail(m.symbol)}>
                  <TokenIcon symbol={m.symbol} size={26} />
                  <span><b>{m.base}</b><em>next {fmtCountdown(m.nextFundingTime)}</em></span>
                  <b className={`num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</b>
                </button>
              ))}
              {positiveFunding.length + negativeFunding.length === 0 && (
                <EmptyState title="No funding rows">Funding extremes appear once the futures feed warms up.</EmptyState>
              )}
            </div>
          </section>

          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Borrow gate</h3>
              <span>reverse-basis pre-check</span>
            </div>
            <button className="strategy-borrow-row" type="button" onClick={() => setPage('loans')}>
              <span className="strategy-borrow-icon"><IconCoins size={16} /></span>
              <span>
                <b>{s.binance.keysPresent ? 'Margin visibility partial' : 'Needs server-side keys'}</b>
                <em>Borrow setups stay advisory until max borrow and interest are confirmed. Open the loan console.</em>
              </span>
            </button>
          </section>

          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Signal history</h3>
              <span>{history.length ? `last ${Math.min(history.length, 8)} of ${history.length}` : 'ledger-backed'}</span>
            </div>
            {history.length > 0 ? (
              <div className="strategy-history-list">
                {history.slice(0, 8).map((r) => {
                  const open = r.closedTs === null;
                  return (
                    <button key={r.id} className="strategy-history-row" type="button" onClick={() => openDetail(r.symbol)}>
                      <TokenIcon symbol={r.symbol} size={26} />
                      <span className="strategy-history-id">
                        <b>{baseOf(r.symbol)}</b>
                        <em>{fmtDateTime(r.openedTs)}</em>
                      </span>
                      <span className="strategy-history-basis num">
                        {fmtBasis(r.basisOpen, 2)} → {fmtBasis(r.basisPeak, 2)}
                      </span>
                      {open
                        ? <StatePill tone="warn">open</StatePill>
                        : <span className="strategy-history-run">{duration(r.openedTs, r.closedTs ?? r.openedTs)}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No history yet">
                Every signal the scanner opens or closes is ledgered and will show here.
              </EmptyState>
            )}
            <button className="strategy-rail-foot" type="button" onClick={() => setPage('ledger')}>
              <IconBook size={13} />
              Full audit trail in the ledger
            </button>
          </section>

          <section className="strategy-rail-card card strategy-next">
            <div className="strategy-rail-head">
              <h3>Not built yet</h3>
              <span>honest roadmap</span>
            </div>
            <div className="strategy-next-row"><IconPulse size={14} /><span><b>Volume-spike monitor</b><em>planned — dead symbols that wake up</em></span></div>
            <div className="strategy-next-row"><IconCoins size={14} /><span><b>Reverse-basis executor</b><em>blocked on borrow visibility</em></span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
