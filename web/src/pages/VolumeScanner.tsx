import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  ChevronDown,
  Eye,
  Radio,
  Search,
  Star,
  X,
} from 'lucide-react';
import { TokenIcon } from '../components/TokenIcon';
import { fmtMoney, fmtPct, fmtPrice, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { useStore } from '../store';
import './VolumeScanner.css';

type Filter = 'all' | 'watching' | 'focus' | 'rejected' | 'warming';

interface WindowMetric {
  quoteVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  priceMovePct: number;
  takerBuyRatio: number | null;
  largeTradeCount: number;
}

interface BaselineMetric {
  ready: boolean;
  samples: number;
  confidence: number;
  quotePerSecNorm: number;
  tradesPerSecNorm: number;
  quotePerMinMedian: number;
  quotePerMinMad: number;
  isDead: boolean;
}

interface VolumeRow {
  symbol: string;
  base: string;
  state: 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';
  price: number | null;
  lastTradeTs: number | null;
  baseline: BaselineMetric;
  windows: Record<string, WindowMetric | undefined>;
  volumeMultiple: Record<string, number | null | undefined>;
  tradeCountMultiple: Record<string, number | null | undefined>;
  spreadBps: number | null;
  topDepthUsd: number | null;
  depthScore: number | null;
  depthVsNorm: number | null;
  takerBuyRatio: number | null;
  washScore: number | null;
  accelerationPctPerMin: number | null;
  focusReason: string | null;
  focusAgeMs: number;
  decisionKind: 'ignore' | 'watch' | 'focus' | 'proposal' | 'reject' | 'warming';
  rejectCode: string | null;
  reason: string;
  correlationId: string | null;
  decisionTs: number | null;
  proposal: {
    id: string;
    status: string;
    direction: string;
    confidence: number | null;
    reason: string;
  } | null;
}

interface VolumeSnapshot {
  updatedAt: number;
  status: {
    running: boolean;
    streamState: 'starting' | 'connecting' | 'open' | 'degraded';
    streamConnections: number;
    openConnections: number;
    bookState: 'fresh' | 'stale';
    universeSize: number;
    eligibleSize: number;
    observedSymbols: number;
    baselineReady: number;
    baselineTotal: number;
    baselineCompleted: number;
    baselineFailed: number;
    watching: number;
    focused: number;
    openProposals: number;
    lastTradeTs: number | null;
    lastBookTs: number | null;
    tradeMessages: number;
    source: string;
    bookSource: string;
    baselineSource: string;
  };
  thresholds: {
    volume1s: number;
    volume5s: number;
    tradeCount: number;
    followthroughPct: number;
    maxSpreadBps: number;
    minDepthScore: number;
    baselineMinutes: number;
  };
  rows: VolumeRow[];
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Symbols' },
  { id: 'watching', label: 'Watching' },
  { id: 'focus', label: 'Focused' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'warming', label: 'Warming' },
];

function multiple(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) + '×' : '—';
}

function numberOrDash(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateLabel(row: VolumeRow): string {
  if (!row.baseline.ready) return 'Warming';
  if (row.state === 'PROPOSED') return 'Proposal';
  if (row.state === 'FOCUS') return 'Focused';
  if (row.state === 'WATCHING') return 'Watching';
  if (row.state === 'COOLDOWN' || row.decisionKind === 'reject') return 'Rejected';
  return 'Monitoring';
}

function stateTone(row: VolumeRow): string {
  if (!row.baseline.ready) return 'warming';
  if (row.state === 'PROPOSED') return 'proposal';
  if (row.state === 'FOCUS') return 'focus';
  if (row.state === 'WATCHING') return 'watching';
  if (row.state === 'COOLDOWN' || row.decisionKind === 'reject') return 'rejected';
  return 'idle';
}

function ratioLabel(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '% Buy';
}

export function VolumeScanner() {
  const { state, openDetail, openLedger, toggleWatch } = useStore();
  const [snapshot, setSnapshot] = useState<VolumeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const poll = createSettledPoll<VolumeSnapshot>({
      intervalMs: 2_000,
      request: (signal) => fetchJson('/api/engine/volume', { cache: 'no-store', signal }),
      onSuccess: (next) => {
        setSnapshot(next);
        setError(null);
      },
      onError: (reason) => setError(apiErrorMessage(reason, 'Volume runtime unavailable')),
    });
    poll.start();
    return poll.stop;
  }, []);

  const rows = snapshot?.rows ?? [];
  const query = search.trim().toUpperCase();
  const counts = useMemo(() => ({
    all: rows.length,
    watching: rows.filter((row) => row.state === 'WATCHING').length,
    focus: rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length,
    rejected: rows.filter((row) => row.state === 'COOLDOWN' || row.decisionKind === 'reject').length,
    warming: rows.filter((row) => !row.baseline.ready).length,
  }), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (query && !row.symbol.includes(query) && !row.base.includes(query) && !row.reason.toUpperCase().includes(query)) return false;
    if (filter === 'watching') return row.state === 'WATCHING';
    if (filter === 'focus') return row.state === 'FOCUS' || row.state === 'PROPOSED';
    if (filter === 'rejected') return row.state === 'COOLDOWN' || row.decisionKind === 'reject';
    if (filter === 'warming') return !row.baseline.ready;
    return true;
  }), [filter, query, rows]);

  const liveFeed = !error && snapshot?.status.streamState === 'open' && snapshot.status.bookState === 'fresh';
  const watchlist = state?.config.watchlist ?? [];

  return (
    <div className="container page volx-page">
      <section className="volx-frame" aria-label="volume workspace">
        <header className="volx-toolbar">
          <div className="volx-title">
            <img className="volx-page-mark" src="/volume-bars.png" alt="" aria-hidden="true" />
            <h1>Volume</h1>
            <span className={'volx-live ' + (liveFeed ? 'active' : error ? 'degraded' : 'starting')}>
              <i aria-hidden="true" />
              {liveFeed ? 'Live' : error ? 'Unavailable' : 'Starting'}
            </span>
            <span className="volx-updated">
              {snapshot ? 'Updated ' + timeAgo(snapshot.updatedAt) : 'Connecting'}
            </span>
          </div>
          <label className="volx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Volume"
              placeholder="Search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpanded(null);
              }}
              spellCheck={false}
            />
            {search ? (
              <button type="button" aria-label="Clear Search" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </header>

        <div className="volx-summary" aria-label="Volume Summary">
          <div className="volx-summary-cell">
            <span>Observed Symbols</span>
            <strong>{snapshot?.status.observedSymbols ?? '—'} <em>/ {snapshot?.status.eligibleSize ?? '—'}</em></strong>
            <small>Exact aggregate-trade streams</small>
          </div>
          <div className="volx-summary-cell">
            <span>Baselines Ready</span>
            <strong>{snapshot?.status.baselineReady ?? '—'} <em>/ {snapshot?.status.baselineTotal ?? '—'}</em></strong>
            <small>{snapshot ? snapshot.thresholds.baselineMinutes + ' completed minutes required' : 'Loading history'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Focus Queue</span>
            <strong>{snapshot ? snapshot.status.watching + snapshot.status.focused : '—'}</strong>
            <small>{snapshot ? snapshot.status.watching + ' watching · ' + snapshot.status.focused + ' focused' : 'Waiting for runtime'}</small>
          </div>
          <div className="volx-summary-cell">
            <span>Open Proposals</span>
            <strong>{snapshot?.status.openProposals ?? '—'}</strong>
            <small>{snapshot?.status.openProposals ? 'Volume proposals in engine' : 'No verified wakeup staged'}</small>
          </div>
        </div>

        <div className="volx-filters">
          <div className="volx-segments" role="tablist" aria-label="Volume Views">
            {FILTERS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setFilter(item.id);
                  setExpanded(null);
                }}
              >
                {item.label}
                <span>{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <span className="volx-view-note">
            {snapshot ? snapshot.status.openConnections + '/' + snapshot.status.streamConnections + ' trade streams · book ' + snapshot.status.bookState : 'Runtime starting'}
          </span>
        </div>

        <div className="volx-table" role="table" aria-label="Volume Scanner Decisions">
          <div className="volx-head" role="row">
            <span role="columnheader">State</span>
            <span role="columnheader">Asset</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Volume Vs Baseline</span>
            <span role="columnheader">Trade Flow</span>
            <span role="columnheader">Market Quality</span>
            <span role="columnheader">Price Move</span>
            <span role="columnheader">Decision</span>
            <span aria-hidden="true" />
          </div>

          {error && !snapshot ? (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>Volume Runtime Unavailable</strong>
              <span>{error}</span>
            </div>
          ) : !snapshot ? (
            <div className="volx-empty">
              <Radio size={18} />
              <strong>Connecting To Volume Runtime</strong>
              <span>Waiting for public Binance trade and book sources.</span>
            </div>
          ) : filteredRows.length ? filteredRows.map((row) => {
            const one = row.windows['1s'];
            const five = row.windows['5s'];
            const minute = row.windows['60s'];
            const isExpanded = expanded === row.symbol;
            const watching = watchlist.includes(row.symbol);
            return (
              <div className="volx-item" role="rowgroup" key={row.symbol}>
                <button
                  type="button"
                  className="volx-row"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : row.symbol)}
                >
                  <span className={'volx-state ' + stateTone(row)} role="cell">
                    <i aria-hidden="true" />
                    {stateLabel(row)}
                  </span>
                  <span className="volx-asset" role="cell">
                    <TokenIcon symbol={row.symbol} size={28} />
                    <span><strong>{row.base}</strong><small>{row.symbol}</small></span>
                  </span>
                  <span className="volx-number" role="cell">
                    <strong>{fmtPrice(row.price)}</strong>
                    <small>{row.lastTradeTs ? timeAgo(row.lastTradeTs) : 'No recent trade'}</small>
                  </span>
                  <span className="volx-window-stack" role="cell">
                    <span><em>1s</em><strong>{multiple(row.volumeMultiple['1s'])}</strong><small>{fmtMoney(one?.quoteVolume ?? null)}</small></span>
                    <span><em>5s</em><strong>{multiple(row.volumeMultiple['5s'])}</strong><small>{fmtMoney(five?.quoteVolume ?? null)}</small></span>
                    <span><em>1m</em><strong>{multiple(row.volumeMultiple['60s'])}</strong><small>{fmtMoney(minute?.quoteVolume ?? null)}</small></span>
                  </span>
                  <span className="volx-tape" role="cell">
                    <strong>{five?.tradeCount ?? 0} Trades</strong>
                    <small>{ratioLabel(row.takerBuyRatio)} · {fmtMoney(five?.avgTradeSize ?? null)} Avg</small>
                  </span>
                  <span className="volx-quality" role="cell">
                    <strong>{row.spreadBps === null ? '—' : row.spreadBps.toFixed(1) + ' bps'}</strong>
                    <small>{fmtMoney(row.topDepthUsd)} Top Depth</small>
                  </span>
                  <span className="volx-move" role="cell">
                    <strong>{fmtPct(five?.priceMovePct ?? null, 3)}</strong>
                    <small>{row.accelerationPctPerMin === null ? '—' : fmtPct(row.accelerationPctPerMin, 2) + '/min'}</small>
                  </span>
                  <span className="volx-decision" role="cell">
                    <strong>{row.rejectCode ? titleCase(row.rejectCode) : titleCase(row.decisionKind)}</strong>
                    <small>{row.reason}</small>
                  </span>
                  <ChevronDown className={isExpanded ? 'expanded' : ''} size={15} aria-hidden="true" />
                </button>

                {isExpanded ? (
                  <div className="volx-detail">
                    <div className="volx-reason">
                      <span>Scanner Decision</span>
                      <p>{row.reason}</p>
                      <small><Radio size={13} />{snapshot.status.source} · {snapshot.status.bookSource}</small>
                    </div>
                    <dl className="volx-facts">
                      <div><dt>Baseline</dt><dd>{row.baseline.samples}/{snapshot.thresholds.baselineMinutes} min</dd></div>
                      <div><dt>Normal Volume</dt><dd>{fmtMoney(row.baseline.quotePerMinMedian)}/min</dd></div>
                      <div><dt>1s Trades</dt><dd>{one?.tradeCount ?? 0}</dd></div>
                      <div><dt>5s Trade Multiple</dt><dd>{multiple(row.tradeCountMultiple['5s'])}</dd></div>
                      <div><dt>Average Trade</dt><dd>{fmtMoney(five?.avgTradeSize ?? null)}</dd></div>
                      <div><dt>Taker Aggression</dt><dd>{ratioLabel(row.takerBuyRatio)}</dd></div>
                      <div><dt>Large Trades · 1m</dt><dd>{minute?.largeTradeCount ?? 0}</dd></div>
                      <div><dt>Depth Score</dt><dd>{numberOrDash(row.depthScore, 2)}</dd></div>
                      <div><dt>Depth Vs Norm</dt><dd>{row.depthVsNorm === null ? '—' : Math.round(row.depthVsNorm * 100) + '%'}</dd></div>
                      <div><dt>Focus Reason</dt><dd>{row.focusReason ? titleCase(row.focusReason) : 'Not Focused'}</dd></div>
                      <div><dt>Reject Code</dt><dd>{row.rejectCode ? titleCase(row.rejectCode) : 'None'}</dd></div>
                      <div><dt>Proposal</dt><dd>{row.proposal ? titleCase(row.proposal.status) : 'None'}</dd></div>
                    </dl>
                    <div className="volx-actions">
                      <button type="button" onClick={() => openDetail(row.symbol)}><Eye size={14} />Open Market</button>
                      <button type="button" className={watching ? 'active' : ''} onClick={() => void toggleWatch(row.symbol)}>
                        <Star size={14} fill={watching ? 'currentColor' : 'none'} />{watching ? 'Watching' : 'Watch'}
                      </button>
                      <button type="button" onClick={() => openLedger(row.symbol)}><BookOpen size={14} />Open Logs</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <div className="volx-empty">
              <Activity size={18} />
              <strong>No Volume Rows Match</strong>
              <span>Change the filter or search term. No rows are simulated.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
