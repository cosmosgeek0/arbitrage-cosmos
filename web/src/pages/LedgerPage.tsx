import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, type Page } from '../store';
import { Dot, Empty, PageHead, Pill, type Tone } from '../components/px';
import { eventSummary } from '../lib/eventText';
import { fmtDateTime, fmtPrice, timeAgo } from '../format';
import type { LedgerEvent } from '../types';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect } from '../components/PillSelect';
import {
  IconBook,
  IconChart,
  IconDatabase,
  IconReceipt,
  IconRefresh,
  IconShield,
  IconTicket,
  IconWallet,
} from '../components/Icons';

type Severity = 'Critical' | 'Warning' | 'Info' | 'Debug';
type SeverityFilter = 'all' | Severity;
type DecisionFilter = 'all' | 'accepted' | 'rejected';
type TimeRange = 'all' | '15m' | '1h' | '24h' | '7d';

const SEVERITIES: Severity[] = ['Critical', 'Warning', 'Info', 'Debug'];
const SEVERITY_TONE: Record<Severity, Tone> = {
  Critical: 'bad',
  Warning: 'warn',
  Info: 'idle',
  Debug: 'idle',
};

const TIME_OPTIONS: { value: TimeRange; label: string; ms: number | null }[] = [
  { value: 'all', label: 'All Time', ms: null },
  { value: '15m', label: 'Last 15 Minutes', ms: 15 * 60 * 1000 },
  { value: '1h', label: 'Last Hour', ms: 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 Hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 Days', ms: 7 * 24 * 60 * 60 * 1000 },
];

const KNOWN_KINDS = [
  'account_snapshot',
  'binance.connected',
  'config_change',
  'engine.start',
  'error_event',
  'feed-open',
  'feed.open',
  'fill_event',
  'heartbeat',
  'loan_request',
  'loan_response',
  'manual_action',
  'order_intent',
  'order_request',
  'order_response',
  'risk_decision',
  'strategy_signal',
  'user_stream',
  'ws.closed',
  'ws.open',
];

const DETAIL_KEYS = [
  'allowed',
  'action',
  'stage',
  'status',
  'result',
  'state',
  'source',
  'feed',
  'service',
  'reason',
  'reasonCode',
  'message',
  'detail',
  'orderId',
  'proposalId',
  'side',
  'type',
  'estNotionalUsd',
  'executedQuoteUsd',
  'imported',
  'fetched',
  'pairs',
  'assets',
  'mode',
];

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function lowerValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function safeJson(value: unknown, spacing = 0): string {
  try {
    return JSON.stringify(value, null, spacing);
  } catch {
    return String(value);
  }
}

function kindLabel(kind: string): string {
  return kind
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function sentenceLabel(value: string): string {
  const label = value.replace(/[._-]/g, ' ').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : value;
}

function sourceLabel(value: string): string {
  return sentenceLabel(value);
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not recorded';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (/usd|notional|price|quote/i.test(key)) return fmtPrice(value);
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length ? value.map((item) => formatDetailValue(key, item)).join(', ') : 'empty';
  const encoded = safeJson(value);
  return encoded.length > 120 ? `${encoded.slice(0, 120)}...` : encoded;
}

function sourceText(ev: LedgerEvent): string {
  const d = asRecord(ev.data);
  const source = [d.source, d.feed, d.stage, d.service, d.module].map(textValue).find(Boolean);
  if (source) return source;
  const kind = ev.kind.toLowerCase();
  if (kind === 'risk_decision') return 'risk gate';
  if (kind === 'strategy_signal') return 'scanner';
  if (kind.startsWith('order') || kind === 'fill_event') return 'execution';
  if (kind === 'account_snapshot' || kind === 'binance.connected' || kind === 'user_stream') return 'account sync';
  if (kind.startsWith('ws') || kind.includes('feed')) return 'market stream';
  if (kind === 'config_change') return 'operator config';
  if (kind === 'manual_action') return 'operator action';
  return 'system';
}

function reasonText(ev: LedgerEvent): string {
  const d = asRecord(ev.data);
  const reasons = Array.isArray(d.reasons) ? d.reasons.map((r) => String(r)).filter(Boolean).join(' / ') : '';
  const direct = [d.reason, d.reasonCode, d.message, d.detail, d.error, d.status, d.result].map(textValue).find(Boolean);
  if (reasons) return reasons;
  if (direct) return direct;
  if (ev.kind === 'risk_decision') return d.allowed === true ? 'risk gate accepted the intent' : 'risk gate rejected the intent';
  if (ev.kind === 'config_change') return 'operator configuration changed';
  if (ev.kind === 'strategy_signal') return 'Scanner proposal recorded';
  if (ev.kind === 'order_intent') return 'order preview created';
  if (ev.kind === 'order_request') return 'order send path requested';
  if (ev.kind === 'order_response') return 'exchange/order response recorded';
  if (ev.kind === 'fill_event') return 'fill recorded in the execution ledger';
  if (ev.kind === 'account_snapshot') return 'account snapshot stored';
  if (ev.kind === 'engine.start') return 'engine process started';
  if (ev.kind === 'ws.open') return 'websocket/feed opened';
  if (ev.kind === 'ws.closed') return 'websocket/feed closed';
  return 'ledger event recorded';
}

function statusText(ev: LedgerEvent): string {
  const d = asRecord(ev.data);
  if (ev.kind === 'risk_decision' && d.allowed !== undefined) return d.allowed === true ? 'accepted' : 'rejected';
  const value = [d.status, d.result, d.state, d.action].map(textValue).find(Boolean);
  if (value) return value;
  if (ev.kind === 'order_intent') return 'preview';
  if (ev.kind === 'order_request') return 'sent';
  if (ev.kind === 'fill_event') return 'filled';
  if (ev.kind === 'strategy_signal') return 'proposal';
  if (ev.kind === 'config_change') return 'changed';
  if (ev.kind === 'ws.open') return 'open';
  if (ev.kind === 'ws.closed') return 'closed';
  return 'recorded';
}

function statusLabel(ev: LedgerEvent): string {
  return sentenceLabel(statusText(ev));
}

function eventTitle(ev: LedgerEvent): string {
  const d = asRecord(ev.data);
  const action = textValue(d.action);
  if (ev.kind === 'strategy_signal') return action ? `Proposal ${action}` : 'Proposal recorded';
  if (ev.kind === 'risk_decision') return d.allowed === true ? 'Risk check approved' : 'Risk check blocked';
  if (ev.kind === 'account_snapshot') return 'Account snapshot';
  if (ev.kind === 'order_intent') return 'Order preview';
  if (ev.kind === 'order_request') return 'Order request';
  if (ev.kind === 'order_response') return 'Order response';
  if (ev.kind === 'fill_event') return 'Fill recorded';
  if (ev.kind === 'config_change') return 'Configuration updated';
  if (ev.kind === 'manual_action') return 'Manual action';
  if (ev.kind === 'engine.start') return 'Engine started';
  if (ev.kind === 'ws.open' || ev.kind === 'feed-open' || ev.kind === 'feed.open') return 'Connection opened';
  if (ev.kind === 'ws.closed') return 'Connection closed';
  if (ev.kind === 'heartbeat') return 'Heartbeat';
  if (ev.kind === 'user_stream') return 'User stream event';
  if (ev.kind === 'error_event') return 'Error recorded';
  return kindLabel(ev.kind);
}

function eventCaption(ev: LedgerEvent): string {
  return reasonText(ev)
    .replace(/\|basis\|/gi, 'Basis')
    .replace(/\bws\.open\b/gi, 'connection opened')
    .replace(/\bws\.closed\b/gi, 'connection closed');
}

function isCancelEvent(ev: LedgerEvent): boolean {
  const d = asRecord(ev.data);
  const hay = [ev.kind, d.action, d.status, d.result, d.message].map(lowerValue).join(' ');
  return hay.includes('cancel') || hay.includes('canceled') || hay.includes('cancelled');
}

function eventSeverity(ev: LedgerEvent): Severity {
  const d = asRecord(ev.data);
  const kind = ev.kind.toLowerCase();
  const status = lowerValue(d.status || d.result || d.state);
  const source = lowerValue(d.source || d.feed || d.service);
  const message = lowerValue(d.message || d.detail || d.error || d.reason);

  if (
    kind === 'heartbeat' ||
    kind.includes('heartbeat') ||
    kind === 'ws.open' ||
    kind === 'feed-open' ||
    kind === 'feed.open' ||
    kind === 'feed_open' ||
    source === 'heartbeat'
  ) {
    return 'Debug';
  }

  if ((ev.kind === 'risk_decision' && d.allowed === false) || ev.kind === 'config_change' || isCancelEvent(ev)) {
    return 'Warning';
  }

  if (
    kind === 'ws.closed' ||
    kind.includes('error') ||
    kind.includes('failure') ||
    kind.includes('failed') ||
    status.includes('fail') ||
    status.includes('down') ||
    source.includes('failure') ||
    source.includes('failed') ||
    message.includes('source failure') ||
    message.includes('unavailable')
  ) {
    return 'Critical';
  }

  return 'Info';
}

function decisionState(ev: LedgerEvent): 'accepted' | 'rejected' | 'unknown' {
  const d = asRecord(ev.data);
  if (d.allowed === true) return 'accepted';
  if (d.allowed === false) return 'rejected';
  const hay = [statusText(ev), d.reason, d.message, d.result, d.status].map(lowerValue).join(' ');
  if (/\b(reject|rejected|blocked|denied|invalid)\b/.test(hay)) return 'rejected';
  if (/\b(accept|accepted|approved|valid|ok|filled|sent|opened)\b/.test(hay)) return 'accepted';
  return 'unknown';
}

function eventMatchesText(ev: LedgerEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    ev.id,
    ev.kind,
    ev.symbol,
    eventSeverity(ev),
    sourceText(ev),
    reasonText(ev),
    statusText(ev),
    eventSummary(ev.kind, asRecord(ev.data), ev.symbol),
    safeJson(ev.data),
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

function detailFields(ev: LedgerEvent): { key: string; value: string }[] {
  const d = asRecord(ev.data);
  return DETAIL_KEYS.filter((key) => key in d).map((key) => ({ key: kindLabel(key), value: formatDetailValue(key, d[key]) }));
}

function relatedIds(ev: LedgerEvent): { orderId: string | null; proposalId: string | null } {
  const d = asRecord(ev.data);
  const intent = asRecord(d.intent);
  const params = asRecord(d.params);
  const proposalId = d.proposalId ?? d.proposal_id ?? (ev.kind === 'strategy_signal' ? d.id : null);
  const orderId = d.orderId ?? d.order_id ?? params.orderId ?? intent.orderId;
  return {
    orderId: orderId === null || orderId === undefined ? null : String(orderId),
    proposalId: proposalId === null || proposalId === undefined ? null : String(proposalId),
  };
}

function contextAction(ev: LedgerEvent): { page: Page; label: string } {
  const severity = eventSeverity(ev);
  if (severity === 'Critical' || ev.kind.startsWith('ws') || ev.kind === 'user_stream') return { page: 'system', label: 'Inspect source health' };
  if (ev.kind === 'risk_decision' || ev.kind === 'config_change') return { page: 'risk', label: 'Inspect risk guard' };
  if (ev.kind.startsWith('order') || ev.kind === 'fill_event') return { page: 'orders', label: 'Inspect execution path' };
  if (ev.kind === 'account_snapshot' || ev.kind === 'binance.connected') return { page: 'account', label: 'Inspect account state' };
  if (ev.kind === 'strategy_signal') return { page: 'opportunities', label: 'Inspect proposal board' };
  return { page: 'system', label: 'Inspect system health' };
}

function sortEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => b.id - a.id || b.ts - a.ts);
}

export function LedgerPage() {
  const { setPage, openDetail, state, prefs } = useStore();
  const stateEvents = state?.events ?? [];
  const [apiEvents, setApiEvents] = useState<LedgerEvent[]>(() => stateEvents);
  const [kind, setKind] = useState('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [symbol, setSymbol] = useState(() => {
    const v = sessionStorage.getItem('cosmos-ledger-symbol') ?? '';
    sessionStorage.removeItem('cosmos-ledger-symbol');
    return v;
  });
  const [query, setQuery] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [showDebug, setShowDebug] = useState(false);
  const [errorFirst, setErrorFirst] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (stateEvents.length && apiEvents.length === 0) setApiEvents(stateEvents);
  }, [apiEvents.length, stateEvents]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '1000' });
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (kind !== 'all') params.set('kind', kind);
    if (/^[A-Z0-9]{5,24}$/.test(normalizedSymbol)) params.set('symbol', normalizedSymbol);
    if (query.trim()) params.set('q', query.trim().slice(0, 60));

    setLoading(true);
    return fetch(`/api/events?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((payload) => {
        setApiEvents(Array.isArray(payload) ? payload as LedgerEvent[] : []);
        setLoadError(null);
        setLastLoaded(Date.now());
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load events'))
      .finally(() => setLoading(false));
  }, [kind, query, symbol]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), Math.max(0.5, prefs.dataCadence?.health ?? 10) * 1000);
    return () => window.clearInterval(t);
  }, [load, prefs.dataCadence?.health]);

  const events = useMemo(() => {
    const map = new Map<number, LedgerEvent>();
    for (const ev of stateEvents) map.set(ev.id, ev);
    for (const ev of apiEvents) map.set(ev.id, ev);
    return sortEvents([...map.values()]);
  }, [apiEvents, stateEvents]);

  const kindOptions = useMemo(() => {
    const seen = new Set([...KNOWN_KINDS, ...events.map((ev) => ev.kind)]);
    return ['all', ...[...seen].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)))];
  }, [events]);

  const baseEvents = useMemo(() => {
    const selectedRange = TIME_OPTIONS.find((opt) => opt.value === timeRange);
    const symbolQuery = symbol.trim().toUpperCase();
    const now = Date.now();
    return events.filter((ev) => {
      if (kind !== 'all' && ev.kind !== kind) return false;
      if (symbolQuery && !(ev.symbol ?? '').toUpperCase().includes(symbolQuery)) return false;
      if (!eventMatchesText(ev, query)) return false;
      if (selectedRange?.ms !== null && selectedRange?.ms !== undefined && now - ev.ts > selectedRange.ms) return false;
      if (decision !== 'all' && decisionState(ev) !== decision) return false;
      return true;
    });
  }, [decision, events, kind, query, symbol, timeRange]);

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { Critical: 0, Warning: 0, Info: 0, Debug: 0 };
    for (const ev of baseEvents) counts[eventSeverity(ev)] += 1;
    return counts;
  }, [baseEvents]);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of baseEvents) counts.set(ev.kind, (counts.get(ev.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [baseEvents]);

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of baseEvents) {
      const source = sourceText(ev);
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [baseEvents]);

  const visible = useMemo(() => baseEvents.filter((ev) => {
    const evSeverity = eventSeverity(ev);
    if (!showDebug && evSeverity === 'Debug') return false;
    if (errorFirst && evSeverity !== 'Critical' && evSeverity !== 'Warning') return false;
    if (!errorFirst && severity !== 'all' && evSeverity !== severity) return false;
    return true;
  }), [baseEvents, errorFirst, severity, showDebug]);

  const shown = useMemo(() => visible.slice(0, 200), [visible]);
  const selected = visible.find((ev) => ev.id === selectedId) ?? shown[0] ?? null;
  const selectedDetailFields = selected ? detailFields(selected) : [];
  const debugHiddenCount = showDebug ? 0 : severityCounts.Debug;
  const canClear = kind !== 'all' || severity !== 'all' || symbol !== '' || query !== '' || timeRange !== 'all' || decision !== 'all' || showDebug || errorFirst;

  useEffect(() => {
    setRawOpen(false);
  }, [selected?.id]);

  function clearFilters(): void {
    setKind('all');
    setSeverity('all');
    setSymbol('');
    setQuery('');
    setTimeRange('all');
    setDecision('all');
    setShowDebug(false);
    setErrorFirst(false);
    setSelectedId(null);
  }

  function focusSeverity(next: Severity): void {
    setSeverity(severity === next ? 'all' : next);
    setErrorFirst(false);
    if (next === 'Debug') setShowDebug(true);
  }

  const liveTone: Tone = loadError ? 'bad' : loading ? 'warn' : 'ok';

  return (
    <div className="container page hp-page wide lg-page">
      <PageHead
        mark={<IconBook size={18} />}
        tone={loadError ? 'bad' : 'idle'}
        title="Logs"
        sub="Every recorded event behind the desk — what happened, what failed, and why."
        meta={
          <>
            <Pill tone={liveTone}>{loadError ? 'Unavailable' : loading ? 'Updating' : 'Live'}</Pill>
            <span>
              {visible.length.toLocaleString('en-US')} of {baseEvents.length.toLocaleString('en-US')} events ·{' '}
              {loadError ?? (lastLoaded ? `updated ${timeAgo(lastLoaded)}` : stateEvents.length ? 'cached' : 'waiting')}
            </span>
          </>
        }
      />

      <div className="lg-filters">
        <input
          className="hp-input lg-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search events"
          spellCheck={false}
        />
        <PillSelect
          value={severity}
          options={[{ id: 'all' as SeverityFilter, label: 'All Severities' }, ...SEVERITIES.map((sev) => ({ id: sev as SeverityFilter, label: sev }))]}
          onChange={(v) => { setSeverity(v); setErrorFirst(false); if (v === 'Debug') setShowDebug(true); }}
          ariaLabel="Severity filter"
        />
        <PillSelect
          value={kind}
          options={kindOptions.map((item) => ({ id: item, label: item === 'all' ? 'All Kinds' : kindLabel(item) }))}
          onChange={setKind}
          ariaLabel="Kind filter"
        />
        <input
          className="hp-input lg-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="BTCUSDT"
          spellCheck={false}
        />
        <PillSelect
          value={timeRange}
          options={TIME_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label }))}
          onChange={(v) => setTimeRange(v)}
          ariaLabel="Time range"
        />
        <PillSelect
          value={decision}
          options={[
            { id: 'all' as DecisionFilter, label: 'All Decisions' },
            { id: 'accepted' as DecisionFilter, label: 'Accepted Only' },
            { id: 'rejected' as DecisionFilter, label: 'Rejected Only' },
          ]}
          onChange={setDecision}
          ariaLabel="Decision filter"
        />
        <span className="lg-filter-gap" />
        <button
          type="button"
          className={`hp-btn lg-toggle${errorFirst ? ' active' : ''}`}
          aria-pressed={errorFirst}
          title="Show only critical and warning events"
          onClick={() => { setErrorFirst((v) => !v); setSeverity('all'); }}
        >
          Errors First
        </button>
        <button
          type="button"
          className={`hp-btn lg-toggle${showDebug ? ' active' : ''}`}
          aria-pressed={showDebug}
          title={showDebug ? 'Connection/heartbeat records are visible' : `${debugHiddenCount.toLocaleString('en-US')} connection records hidden`}
          onClick={() => setShowDebug((v) => !v)}
        >
          Connections
        </button>
        <button type="button" className="hp-btn" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={13} />
          Refresh
        </button>
        <button type="button" className="hp-btn" onClick={clearFilters} disabled={!canClear} title={!canClear ? 'No active filters to clear' : 'Reset all Logs filters'}>
          Clear
        </button>
      </div>

      <div className="lg-grid">
        <aside className="lg-facets" aria-label="Logs facets">
          <section className="hp-group lg-facet">
            <h3>Severity</h3>
            {SEVERITIES.map((sev) => (
              <button
                type="button"
                key={sev}
                className={!errorFirst && severity === sev ? 'active' : ''}
                onClick={() => focusSeverity(sev)}
              >
                <Dot tone={SEVERITY_TONE[sev]} />
                <span>{sev}</span>
                <b>{severityCounts[sev].toLocaleString('en-US')}</b>
              </button>
            ))}
          </section>
          <section className="hp-group lg-facet">
            <h3>Kinds</h3>
            {kindCounts.map(([item, count]) => (
              <button type="button" key={item} className={kind === item ? 'active' : ''} onClick={() => setKind(kind === item ? 'all' : item)}>
                <span>{kindLabel(item)}</span>
                <b>{count.toLocaleString('en-US')}</b>
              </button>
            ))}
          </section>
          <section className="hp-group lg-facet">
            <h3>Sources</h3>
            {sourceCounts.map(([item, count]) => (
              <button type="button" key={item} className={query === item ? 'active' : ''} onClick={() => setQuery(query === item ? '' : item)}>
                <span>{sourceLabel(item)}</span>
                <b>{count.toLocaleString('en-US')}</b>
              </button>
            ))}
          </section>
        </aside>

        <section className="hp-group lg-feed" aria-label="Event Activity">
          <div className="lg-feed-head">
            <h3>Event Activity</h3>
            <span>{shown.length < visible.length ? `First ${shown.length} Of ${visible.length.toLocaleString('en-US')} Rows` : `${visible.length.toLocaleString('en-US')} Rows`}</span>
          </div>
          {shown.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No matching events">Adjust or clear the filters to see recorded activity.</Empty>
            </div>
          ) : (
            <div className="lg-list" role="listbox" aria-label="Event Activity">
              {shown.map((ev) => {
                const evSeverity = eventSeverity(ev);
                const selectedRow = selected?.id === ev.id;
                return (
                  <div
                    key={ev.id}
                    className={`lg-row${selectedRow ? ' selected' : ''}`}
                    onClick={() => setSelectedId(ev.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(ev.id);
                      }
                    }}
                    role="option"
                    tabIndex={0}
                    aria-selected={selectedRow}
                  >
                    <span className="lg-time" title={fmtDateTime(ev.ts)}>{timeAgo(ev.ts)}</span>
                    <Dot tone={SEVERITY_TONE[evSeverity]} />
                    <span className="lg-main" title={`${eventTitle(ev)} — ${eventCaption(ev)}`}>
                      <b>{eventTitle(ev)}</b>
                      <em> — {eventCaption(ev)}</em>
                    </span>
                    {ev.symbol ? (
                      <button
                        type="button"
                        className="lg-sym"
                        onClick={(e) => { e.stopPropagation(); openDetail(ev.symbol as string); }}
                        title={`Inspect ${ev.symbol} market detail`}
                      >
                        <TokenIcon symbol={ev.symbol} size={14} />
                        {ev.symbol}
                      </button>
                    ) : (
                      <span className="lg-sym system">system</span>
                    )}
                    <span className="lg-src" title={`${kindLabel(ev.kind)} · ${sourceLabel(sourceText(ev))}`}>{sourceLabel(sourceText(ev))}</span>
                    <span className="lg-status">{statusLabel(ev)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="hp-group lg-inspect" aria-label="Event details">
          {selected ? (
            <>
              <div className="lg-inspect-head">
                <Pill tone={SEVERITY_TONE[eventSeverity(selected)]}>{eventSeverity(selected)}</Pill>
                <h3>{eventTitle(selected)}</h3>
                <span>#{selected.id} · {kindLabel(selected.kind)}</span>
              </div>
              <dl className="lg-facts">
                <div><dt>Time</dt><dd>{fmtDateTime(selected.ts)} · {timeAgo(selected.ts)}</dd></div>
                <div><dt>Source</dt><dd>{sourceLabel(sourceText(selected))}</dd></div>
                <div><dt>Reason</dt><dd>{eventCaption(selected)}</dd></div>
                <div><dt>Status</dt><dd>{statusLabel(selected)}</dd></div>
                <div><dt>Symbol</dt><dd>{selected.symbol ?? 'system'}</dd></div>
                {selectedDetailFields.map((field) => (
                  <div key={field.key}><dt>{field.key}</dt><dd>{field.value}</dd></div>
                ))}
              </dl>
              <div className="lg-related">
                {(() => {
                  const ids = relatedIds(selected);
                  const ctx = contextAction(selected);
                  return (
                    <>
                      {ids.proposalId ? (
                        <button type="button" className="hp-btn" onClick={() => setPage('opportunities')}>
                          <IconChart size={13} />
                          Open proposal #{ids.proposalId}
                        </button>
                      ) : null}
                      {ids.orderId ? (
                        <button type="button" className="hp-btn" onClick={() => setPage('orders')}>
                          <IconTicket size={13} />
                          Open order #{ids.orderId}
                        </button>
                      ) : null}
                      <button type="button" className="hp-btn" onClick={() => setPage(ctx.page)}>
                        {ctx.page === 'system' ? <IconDatabase size={13} /> : ctx.page === 'risk' ? <IconShield size={13} /> : ctx.page === 'account' ? <IconWallet size={13} /> : <IconReceipt size={13} />}
                        {ctx.label}
                      </button>
                    </>
                  );
                })()}
              </div>
              <details className="lg-raw" open={rawOpen} onToggle={(e) => setRawOpen(e.currentTarget.open)}>
                <summary>Raw JSON</summary>
                <pre>{safeJson(selected, 2)}</pre>
              </details>
            </>
          ) : (
            <div className="lg-empty-pad">
              <Empty title="No event selected">Select a row to inspect its ledger record.</Empty>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
