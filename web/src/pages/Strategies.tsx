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
  IconPercent,
  IconPulse,
  IconRadar,
  IconShield,
  IconTicket,
} from '../components/Icons';
import { baseOf, duration, fmtBasis, fmtDateTime, fmtFunding, fmtMoney, fmtPct, signClass, timeAgo } from '../format';
import type { MarketRow, Proposal, SignalRecord } from '../types';

type StrategyId = 'basis' | 'funding' | 'borrow' | 'volume';
type FundingExtremes = { positive: MarketRow[]; negative: MarketRow[] };

const STRATEGY_LABEL: Record<StrategyId, string> = {
  basis: 'Basis spread',
  funding: 'Funding carry',
  borrow: 'Borrow feasibility',
  volume: 'Volume anomaly',
};

const STRATEGY_SUMMARY: Record<StrategyId, string> = {
  basis: 'Spot/perp dislocation monitor that can open manual proposals.',
  funding: 'Funding-rate extremes that may become carry candidates after basis and depth checks.',
  borrow: 'Cross-margin availability pre-check for reverse-basis setups.',
  volume: 'Liquidity and activity watchlist. It is context today, not an auto strategy.',
};

const SIDE_LABEL: Record<Proposal['side'], string> = {
  SHORT_PERP_LONG_SPOT: 'Short perp / long spot',
  LONG_PERP_SHORT_SPOT: 'Long perp / short spot',
};

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function abs(v: number | null | undefined): number {
  return finite(v) ? Math.abs(v) : 0;
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function proposalScore(p: Proposal): number {
  const edge = clampScore(abs(p.netEdgePct) * 34);
  const confidence = clampScore(p.confidence * 100) * 0.42;
  const liquidity = clampScore(((p.quoteVolume24h ?? 0) / 50_000_000) * 100) * 0.16;
  const agePenalty = Math.min(10, Math.max(0, (Date.now() - p.openedTs) / 1000 / 60 / 16));
  return clampScore(36 + edge + confidence + liquidity - agePenalty);
}

function marketScore(m: MarketRow, threshold: number): number {
  const edge = Math.max(0, abs(m.basisPct) - threshold);
  const liquidity = clampScore(((m.quoteVolume24h ?? 0) / 40_000_000) * 100);
  return clampScore(edge * 85 + liquidity * 0.25);
}

function fundingScore(m: MarketRow): number {
  const liquidity = clampScore(((m.quoteVolume24h ?? 0) / 40_000_000) * 100);
  return clampScore(abs(m.fundingRate) * 11000 + liquidity * 0.2);
}

function fmtNumber(v: number | null | undefined): string {
  if (!finite(v)) return '-';
  return Intl.NumberFormat('en-US').format(v);
}

function statusCopy(status: 'live' | 'partial' | 'idle'): { tone: 'ok' | 'warn' | 'idle'; label: string } {
  if (status === 'live') return { tone: 'ok', label: 'running' };
  if (status === 'partial') return { tone: 'warn', label: 'needs keys' };
  return { tone: 'idle', label: 'context only' };
}

function ScoreMeter({ value }: { value: number }) {
  const lit = Math.max(0, Math.min(10, Math.round(value / 10)));
  return (
    <span className="strategy-score-meter" aria-label={`score ${Math.round(value)}`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className={i < lit ? 'on' : ''} />
      ))}
    </span>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="strategy-metric">
      <span>{label}</span>
      <b className={`num ${tone ?? ''}`}>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function MonitorCard({
  id,
  icon,
  status,
  score,
  primary,
  secondary,
  active,
  onSelect,
  action,
  children,
}: {
  id: StrategyId;
  icon: ReactNode;
  status: 'live' | 'partial' | 'idle';
  score: number;
  primary: ReactNode;
  secondary: ReactNode;
  active: boolean;
  onSelect: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const copy = statusCopy(status);
  return (
    <article className={`strategy-monitor-card ${active ? 'selected' : ''}`}>
      <button className="strategy-monitor-head" type="button" onClick={onSelect}>
        <span className={`strategy-monitor-icon ${id}`}>{icon}</span>
        <span className="strategy-monitor-title">
          <b>{STRATEGY_LABEL[id]}</b>
          <em>{STRATEGY_SUMMARY[id]}</em>
        </span>
        <StatePill tone={copy.tone}>{copy.label}</StatePill>
      </button>
      <div className="strategy-monitor-body">
        <div className="strategy-monitor-score">
          <span>Readiness</span>
          <b className="num">{Math.round(score)}</b>
          <ScoreMeter value={score} />
        </div>
        <div className="strategy-monitor-copy">
          <strong>{primary}</strong>
          <span>{secondary}</span>
        </div>
      </div>
      {children}
      {action && <div className="strategy-monitor-actions">{action}</div>}
    </article>
  );
}

function TokenSignalRow({
  row,
  metric,
  detail,
  score,
  onOpen,
}: {
  row: MarketRow;
  metric: ReactNode;
  detail: ReactNode;
  score: number;
  onOpen: () => void;
}) {
  return (
    <button className="strategy-token-row" type="button" onClick={onOpen}>
      <span className="strategy-token-name">
        <TokenIcon symbol={row.symbol} size={30} />
        <span>
          <b>{row.base}</b>
          <em>{row.symbol}</em>
        </span>
      </span>
      <span className="strategy-token-spark">
        <Sparkline values={row.spark} color={brandColor(row.symbol)} />
      </span>
      <span className="strategy-token-value">{metric}</span>
      <span className="strategy-token-detail">{detail}</span>
      <span className="strategy-token-score">
        <b className="num">{Math.round(score)}</b>
        <ScoreMeter value={score} />
      </span>
    </button>
  );
}

function ProposalRunway({
  proposal,
  market,
  onOpen,
  onQueue,
}: {
  proposal: Proposal;
  market?: MarketRow;
  onOpen: () => void;
  onQueue: () => void;
}) {
  const score = proposalScore(proposal);
  return (
    <article className="strategy-proposal-card">
      <button className="strategy-proposal-head" type="button" onClick={onOpen}>
        <TokenIcon symbol={proposal.symbol} size={38} />
        <span>
          <b>{baseOf(proposal.symbol)}</b>
          <em>{proposal.symbol} / {SIDE_LABEL[proposal.side]}</em>
        </span>
        <strong className="num">{Math.round(score)}</strong>
      </button>
      <div className="strategy-proposal-chart">
        <SparkArea values={market?.spark ?? []} color={brandColor(proposal.symbol)} dots endDot />
      </div>
      <div className="strategy-proposal-grid">
        <Metric label="Net edge" value={fmtPct(proposal.netEdgePct, 2)} tone={signClass(proposal.netEdgePct)} />
        <Metric label="Basis now" value={fmtBasis(proposal.basisNow, 2)} tone={signClass(proposal.basisNow)} />
        <Metric label="Funding" value={fmtFunding(proposal.fundingRate)} tone={signClass(proposal.fundingRate)} />
      </div>
      <button className="mini-btn" type="button" onClick={onQueue}>Open in queue</button>
    </article>
  );
}

function HistoryRow({ row, onOpen }: { row: SignalRecord; onOpen: () => void }) {
  const isOpen = row.closedTs === null;
  return (
    <button className={`strategy-history-row ${isOpen ? 'open' : ''}`} type="button" onClick={onOpen}>
      <span className="strategy-history-token">
        <TokenIcon symbol={row.symbol} size={30} />
        <span>
          <b>{baseOf(row.symbol)}</b>
          <em>{fmtDateTime(row.openedTs)}</em>
        </span>
      </span>
      <span>
        <b>{row.side === 'SHORT_PERP_LONG_SPOT' ? 'Carry setup' : 'Borrow setup'}</b>
        <em>{isOpen ? 'open signal' : duration(row.openedTs, row.closedTs ?? row.openedTs)}</em>
      </span>
      <span className={`num ${signClass(row.basisOpen)}`}>{fmtBasis(row.basisOpen, 2)}</span>
      <span className={`num ${signClass(row.basisPeak)}`}>{fmtBasis(row.basisPeak, 2)}</span>
      <span className="strategy-history-state">{isOpen ? 'open' : 'closed'}</span>
    </button>
  );
}

export function Strategies() {
  const { state, markets, setPage, openDetail } = useStore();
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [extremes, setExtremes] = useState<FundingExtremes | null>(null);
  const [selected, setSelected] = useState<StrategyId>('basis');

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
  const minVolume = s?.config.minQuoteVolume24h ?? 0;
  const proposals = s?.proposals ?? [];
  const proposalBySymbol = useMemo(() => new Map(proposals.map((p) => [p.symbol, p])), [proposals]);
  const marketBySymbol = useMemo(() => new Map(markets.map((m) => [m.symbol, m])), [markets]);

  const liquidPerps = useMemo(
    () => markets.filter((m) => m.hasPerp && (m.quoteVolume24h ?? 0) >= minVolume),
    [markets, minVolume]
  );

  const basisLeaders = useMemo(
    () =>
      [...liquidPerps]
        .filter((m) => finite(m.basisPct))
        .sort((a, b) => abs(b.basisPct) - abs(a.basisPct))
        .slice(0, 8),
    [liquidPerps]
  );

  const fundingFallback = useMemo(
    () =>
      [...liquidPerps]
        .filter((m) => finite(m.fundingRate))
        .sort((a, b) => abs(b.fundingRate) - abs(a.fundingRate))
        .slice(0, 16),
    [liquidPerps]
  );

  const positiveFunding = (extremes?.positive.length ? extremes.positive : fundingFallback.filter((m) => (m.fundingRate ?? 0) > 0)).slice(0, 5);
  const negativeFunding = (extremes?.negative.length ? extremes.negative : fundingFallback.filter((m) => (m.fundingRate ?? 0) < 0)).slice(0, 5);

  const volumeLeaders = useMemo(
    () =>
      [...markets]
        .filter((m) => (m.quoteVolume24h ?? 0) > 0)
        .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
        .slice(0, 8),
    [markets]
  );

  const rankedProposals = useMemo(() => [...proposals].sort((a, b) => proposalScore(b) - proposalScore(a)), [proposals]);
  const aboveThreshold = basisLeaders.filter((m) => abs(m.basisPct) >= threshold).length;
  const openSignals = history.filter((h) => h.closedTs === null).length;
  const scannerFresh = s?.scanner.lastTickTs ? Date.now() - s.scanner.lastTickTs < 45_000 : false;
  const basisReadiness = clampScore((scannerFresh ? 35 : 12) + (aboveThreshold ? 22 : 0) + proposals.length * 10 + Math.min(20, liquidPerps.length / 18));
  const fundingReadiness = clampScore((positiveFunding.length + negativeFunding.length) * 8 + Math.min(22, liquidPerps.length / 24));
  const borrowReadiness = s?.binance.keysPresent ? 54 : 22;
  const volumeReadiness = clampScore(Math.min(72, volumeLeaders.length * 7 + Math.min(20, markets.length / 18)));
  const selectedCopy = statusCopy(selected === 'basis' || selected === 'funding' ? 'live' : selected === 'borrow' ? 'partial' : 'idle');

  if (!s) {
    return <div className="container page"><div className="empty-state">Connecting...</div></div>;
  }

  return (
    <div className="container page strategies-page">
      <section className="strategy-hero card">
        <div className="strategy-hero-copy">
          <span className="strategy-eyebrow">
            <IconBrain size={15} />
            strategy command
          </span>
          <h1 className="page-title">Strategies</h1>
          <p>
            Monitors only. Strategies can create scanner proposals, but every order still goes through manual review,
            typed confirmation, risk gate, allowlist, and the ledger.
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
        <div className="strategy-hero-orb">
          <span className="strategy-orb-core">
            <IconPulse size={34} />
          </span>
          <b className="num">{rankedProposals.length}</b>
          <em>live proposals</em>
          <StatePill tone={s.mode === 'HALTED' ? 'bad' : s.mode === 'LIVE_ARMED' ? 'ok' : 'warn'}>{s.mode.toLowerCase().replace('_', ' ')}</StatePill>
        </div>
      </section>

      <section className="strategy-metric-grid">
        <Metric label="Scanner heartbeat" value={s.scanner.lastTickTs ? timeAgo(s.scanner.lastTickTs) : '-'} sub={`${fmtNumber(s.scanner.pairs)} exact pairs`} tone={scannerFresh ? 'up' : 'down'} />
        <Metric label="Active signals" value={<Num value={rankedProposals.length}>{rankedProposals.length}</Num>} sub={`${openSignals} ledger-open`} tone={rankedProposals.length ? 'up' : ''} />
        <Metric label="Basis threshold" value={`${threshold.toFixed(2)}%`} sub={`${s.config.persistTicks} ticks / fees ${fmtPct(s.config.feesPct, 2, false)}`} />
        <Metric label="Min liquidity" value={fmtMoney(minVolume)} sub={`${fmtNumber(liquidPerps.length)} liquid perp rows`} />
      </section>

      <div className="strategy-layout">
        <main className="strategy-main">
          <section className="strategy-monitor-grid">
            <MonitorCard
              id="basis"
              icon={<IconPercent size={20} />}
              status="live"
              score={basisReadiness}
              primary={`${fmtNumber(s.scanner.watching)} watching / ${rankedProposals.length} proposing`}
              secondary={`Threshold ${threshold.toFixed(2)}%, ${s.config.persistTicks} tick persistence, ${fmtMoney(minVolume)} minimum volume.`}
              active={selected === 'basis'}
              onSelect={() => setSelected('basis')}
              action={<button className="mini-btn" type="button" onClick={() => setPage('opportunities')}>Inspect queue</button>}
            >
              <div className="strategy-mini-strip">
                {basisLeaders.slice(0, 4).map((m) => (
                  <button key={m.symbol} type="button" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={24} />
                    <span>{m.base}</span>
                    <b className={`num ${signClass(m.basisPct)}`}>{fmtBasis(m.basisPct, 2)}</b>
                  </button>
                ))}
              </div>
            </MonitorCard>

            <MonitorCard
              id="funding"
              icon={<IconPulse size={20} />}
              status="live"
              score={fundingReadiness}
              primary={`${positiveFunding.length + negativeFunding.length} funding extremes loaded`}
              secondary="Use as raw material only; basis, depth, borrow, and risk still decide whether a ticket is worth opening."
              active={selected === 'funding'}
              onSelect={() => setSelected('funding')}
              action={<button className="mini-btn" type="button" onClick={() => setSelected('funding')}>Show extremes</button>}
            >
              <div className="strategy-mini-strip">
                {[...positiveFunding.slice(0, 2), ...negativeFunding.slice(0, 2)].map((m) => (
                  <button key={m.symbol} type="button" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={24} />
                    <span>{m.base}</span>
                    <b className={`num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</b>
                  </button>
                ))}
              </div>
            </MonitorCard>

            <MonitorCard
              id="borrow"
              icon={<IconCoins size={20} />}
              status={s.binance.keysPresent ? 'partial' : 'partial'}
              score={borrowReadiness}
              primary={s.binance.keysPresent ? 'Read-only account context available' : 'Server has no Binance keys'}
              secondary="Reverse-basis trades require borrow visibility before any live ticket makes sense."
              active={selected === 'borrow'}
              onSelect={() => setSelected('borrow')}
              action={<button className="mini-btn" type="button" onClick={() => setPage('loans')}>Open loans</button>}
            />

            <MonitorCard
              id="volume"
              icon={<IconChart size={20} />}
              status="idle"
              score={volumeReadiness}
              primary={`${volumeLeaders.length} liquidity leaders available`}
              secondary="This is a market-context lane. It helps prioritize symbols; it does not pretend to generate trades yet."
              active={selected === 'volume'}
              onSelect={() => setSelected('volume')}
              action={<button className="mini-btn" type="button" onClick={() => setPage('markets')}>Open markets</button>}
            >
              <div className="strategy-mini-strip">
                {volumeLeaders.slice(0, 4).map((m) => (
                  <button key={m.symbol} type="button" onClick={() => openDetail(m.symbol)}>
                    <TokenIcon symbol={m.symbol} size={24} />
                    <span>{m.base}</span>
                    <b className="num">{fmtMoney(m.quoteVolume24h)}</b>
                  </button>
                ))}
              </div>
            </MonitorCard>
          </section>

          <section className="strategy-section">
            <div className="strategy-section-head">
              <div>
                <h2>{selected === 'basis' ? 'Basis candidates' : selected === 'funding' ? 'Funding extremes' : selected === 'borrow' ? 'Borrow gate' : 'Liquidity context'}</h2>
                <span>
                  {selected === 'basis'
                    ? 'Ranked by absolute basis edge and liquidity.'
                    : selected === 'funding'
                      ? 'Positive and negative funding extremes from the public market feed.'
                      : selected === 'borrow'
                        ? 'The safety check before any reverse-basis setup can be trusted.'
                        : 'High-volume symbols to watch while the strategy lane is not armed.'}
                </span>
              </div>
              <StatePill tone={selectedCopy.tone}>{selectedCopy.label}</StatePill>
            </div>

            {selected === 'basis' && (
              <div className="strategy-token-board card">
                {basisLeaders.slice(0, 8).map((m) => (
                  <TokenSignalRow
                    key={m.symbol}
                    row={m}
                    metric={<span className={`num ${signClass(m.basisPct)}`}>{fmtBasis(m.basisPct, 2)}</span>}
                    detail={`${fmtMoney(m.quoteVolume24h)} 24h volume`}
                    score={proposalBySymbol.has(m.symbol) ? Math.max(76, marketScore(m, threshold)) : marketScore(m, threshold)}
                    onOpen={() => openDetail(m.symbol)}
                  />
                ))}
              </div>
            )}

            {selected === 'funding' && (
              <div className="strategy-funding-grid">
                <div className="strategy-token-board card">
                  <div className="strategy-board-title">
                    <b>Shorts get paid</b>
                    <span>positive funding</span>
                  </div>
                  {positiveFunding.map((m) => (
                    <TokenSignalRow
                      key={m.symbol}
                      row={m}
                      metric={<span className={`num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</span>}
                      detail={`${fmtBasis(m.basisPct, 2)} basis`}
                      score={fundingScore(m)}
                      onOpen={() => openDetail(m.symbol)}
                    />
                  ))}
                </div>
                <div className="strategy-token-board card">
                  <div className="strategy-board-title">
                    <b>Longs get paid</b>
                    <span>negative funding</span>
                  </div>
                  {negativeFunding.map((m) => (
                    <TokenSignalRow
                      key={m.symbol}
                      row={m}
                      metric={<span className={`num ${signClass(m.fundingRate)}`}>{fmtFunding(m.fundingRate)}</span>}
                      detail={`${fmtBasis(m.basisPct, 2)} basis`}
                      score={fundingScore(m)}
                      onOpen={() => openDetail(m.symbol)}
                    />
                  ))}
                </div>
              </div>
            )}

            {selected === 'borrow' && (
              <div className="strategy-borrow-card card">
                <span className="strategy-borrow-icon"><IconShield size={24} /></span>
                <div>
                  <h3>{s.binance.keysPresent ? 'Borrow checks are partially available' : 'Borrow checks need server-side keys'}</h3>
                  <p>
                    The page does not fake borrowability. Reverse-basis candidates stay advisory until margin visibility
                    can confirm loanable asset, max borrow, interest, and account risk.
                  </p>
                  <div className="strategy-borrow-actions">
                    <button className="cta-pill" type="button" onClick={() => setPage('loans')}>Open loan console</button>
                    <button className="mini-btn" type="button" onClick={() => setPage('risk')}>Risk guardrails</button>
                  </div>
                </div>
              </div>
            )}

            {selected === 'volume' && (
              <div className="strategy-token-board card">
                {volumeLeaders.map((m) => (
                  <TokenSignalRow
                    key={m.symbol}
                    row={m}
                    metric={<span className="num">{fmtMoney(m.quoteVolume24h)}</span>}
                    detail={`${fmtPct(m.change24hPct, 2)} 24h change`}
                    score={volumeReadiness}
                    onOpen={() => openDetail(m.symbol)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="strategy-rail">
          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Proposal runway</h3>
              <span>scanner to manual ticket</span>
            </div>
            {rankedProposals.length > 0 ? (
              <div className="strategy-proposal-list">
                {rankedProposals.slice(0, 3).map((p) => (
                  <ProposalRunway
                    key={p.id}
                    proposal={p}
                    market={marketBySymbol.get(p.symbol)}
                    onOpen={() => openDetail(p.symbol)}
                    onQueue={() => setPage('opportunities')}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="No live proposals">
                The scanner is running, but no persisted edge is strong enough for the manual queue.
              </EmptyState>
            )}
          </section>

          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Execution chain</h3>
              <span>safety before sends</span>
            </div>
            <div className="strategy-chain">
              <div><IconRadar size={15} /><span><b>Monitor</b><em>public market feeds only</em></span></div>
              <div><IconTicket size={15} /><span><b>Manual ticket</b><em>proposal only prefills</em></span></div>
              <div><IconShield size={15} /><span><b>Risk gate</b><em>server-side re-check</em></span></div>
              <div><IconBook size={15} /><span><b>Ledger</b><em>every action recorded</em></span></div>
            </div>
          </section>

          <section className="strategy-rail-card card">
            <div className="strategy-rail-head">
              <h3>Signal history</h3>
              <span>{history.length} recent records</span>
            </div>
            {history.length > 0 ? (
              <div className="strategy-history-list">
                {history.slice(0, 8).map((r) => (
                  <HistoryRow key={r.id} row={r} onOpen={() => openDetail(r.symbol)} />
                ))}
              </div>
            ) : (
              <EmptyState title="No strategy history">
                Ledger-backed proposals will appear here once the scanner opens them.
              </EmptyState>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
