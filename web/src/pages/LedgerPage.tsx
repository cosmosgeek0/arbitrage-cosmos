import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, type Page } from '../store';
import { EmptyState, KindChip } from '../components/ui';
import { eventSummary } from '../lib/eventText';
import { fmtDateTime, fmtPrice, timeAgo } from '../format';
import type { LedgerEvent } from '../types';
import { TokenIcon } from '../components/TokenIcon';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconClock,
  IconDatabase,
  IconGear,
  IconList,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTicket,
  IconWallet,
  IconWifi,
} from '../components/Icons';

type Severity = 'Critical' | 'Warning' | 'Info' | 'Debug';
type SeverityFilter = 'all' | Severity;
type DecisionFilter = 'all' | 'accepted' | 'rejected';
type TimeRange = 'all' | '15m' | '1h' | '24h' | '7d';

const SEVERITIES: Severity[] = ['Critical', 'Warning', 'Info', 'Debug'];
const SEVERITY_COPY: Record<Severity, { label: string; sub: string; icon: ReactNode }> = {
  Critical: { label: 'Critical', sub: 'Needs immediate review', icon: <IconAlert size={15} /> },
  Warning: { label: 'Warning', sub: 'Review before trading', icon: <IconShield size={15} /> },
  Info: { label: 'Info', sub: 'Recorded activity', icon: <IconReceipt size={15} /> },
  Debug: { label: 'Debug', sub: 'Connection records', icon: <IconWifi size={15} /> },
};

const TIME_OPTIONS: { value: TimeRange; label: string; ms: number | null }[] = [
  { value: 'all', label: 'All time', ms: null },
  { value: '15m', label: 'Last 15 minutes', ms: 15 * 60 * 1000 },
  { value: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
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

function eventTone(ev: LedgerEvent): string {
  return `logs-sev-${eventSeverity(ev).toLowerCase()}`;
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

function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`logs-severity-pill ${eventTone({ id: 0, ts: 0, kind: severity === 'Debug' ? 'ws.open' : severity === 'Warning' ? 'config_change' : severity === 'Critical' ? 'error_event' : 'engine.start', symbol: null, data: null })}`}>{severity}</span>;
}

function IncidentButton({
  severity,
  count,
  active,
  onClick,
}: {
  severity: Severity;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = SEVERITY_COPY[severity];
  return (
    <button type="button" className={`logs-incident ${active ? 'logs-active' : ''} logs-sev-${severity.toLowerCase()}`} onClick={onClick}>
      <span className="logs-incident-icon">{meta.icon}</span>
      <span className="logs-incident-copy">
        <b>{meta.label}</b>
        <em>{meta.sub}</em>
      </span>
      <strong>{count.toLocaleString('en-US')}</strong>
    </button>
  );
}

export function LedgerPage() {
  const { setPage, openDetail, state } = useStore();
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
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

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

  const selected = visible.find((ev) => ev.id === selectedId) ?? visible[0] ?? null;
  const selectedDetailFields = selected ? detailFields(selected) : [];
  const latestCritical = baseEvents.find((ev) => eventSeverity(ev) === 'Critical') ?? null;
  const debugHiddenCount = showDebug ? 0 : severityCounts.Debug;
  const canClear = kind !== 'all' || severity !== 'all' || symbol !== '' || query !== '' || timeRange !== 'all' || decision !== 'all' || showDebug || errorFirst;
  const activeFilterCount = [
    kind !== 'all',
    severity !== 'all',
    symbol !== '',
    query !== '',
    timeRange !== 'all',
    decision !== 'all',
    showDebug,
    errorFirst,
  ].filter(Boolean).length;

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

  function chooseSeverity(next: SeverityFilter): void {
    setSeverity(next);
    setErrorFirst(false);
    if (next === 'Debug') setShowDebug(true);
  }

  function focusSeverity(next: Severity): void {
    setSeverity(next);
    setErrorFirst(false);
    if (next === 'Debug') setShowDebug(true);
  }

  function toggleErrorFirst(): void {
    setErrorFirst((v) => !v);
    setSeverity('all');
  }

  function inspectSymbol(sym: string): void {
    openDetail(sym);
  }

  return (
    <div className="container page ledger-page logs-page">
      <header className="logs-head">
        <span className="logs-mark"><IconBook size={22} /></span>
        <div className="logs-head-copy">
          <h1>Logs</h1>
          <p>What happened, what failed, and why — every recorded event behind the desk.</p>
        </div>
        <div className="logs-head-meta">
          <span className={`logs-live ${loadError ? 'logs-sev-critical' : loading ? 'logs-sev-warning' : 'logs-sev-info'}`}>
            <span className="logs-live-dot" />
            {loadError ? 'Unavailable' : loading ? 'Updating' : 'Live'}
          </span>
          <span>
            {visible.length.toLocaleString('en-US')} of {baseEvents.length.toLocaleString('en-US')} events ·{' '}
            {loadError ?? (lastLoaded ? `updated ${timeAgo(lastLoaded)}` : stateEvents.length ? 'cached' : 'waiting')}
          </span>
        </div>
      </header>

      <section className="logs-console">
        <div className="logs-preference-group" aria-label="View controls">
          <div className="logs-pref-row">
            <span className="logs-pref-icon logs-pref-alert"><IconAlert size={17} /></span>
            <span className="logs-pref-copy">
              <b>Errors and warnings first</b>
              <em>{latestCritical ? `Latest critical event ${timeAgo(latestCritical.ts)}` : 'Hide routine activity — show only critical and warning events'}</em>
            </span>
            <button type="button" className={`logs-switch ${errorFirst ? 'logs-on' : ''}`} aria-label="Toggle errors and warnings first" aria-pressed={errorFirst} onClick={toggleErrorFirst}>
              <span />
            </button>
          </div>

          <div className="logs-pref-row">
            <span className="logs-pref-icon logs-pref-debug"><IconWifi size={17} /></span>
            <span className="logs-pref-copy">
              <b>Connection records</b>
              <em>{showDebug ? 'Heartbeat and connection-open records are visible' : `${debugHiddenCount.toLocaleString('en-US')} connection records hidden`}</em>
            </span>
            <button type="button" className={`logs-switch ${!showDebug ? 'logs-on' : ''}`} aria-label="Toggle connection records" aria-pressed={!showDebug} onClick={() => setShowDebug((v) => !v)}>
              <span />
            </button>
          </div>
        </div>

        <div className="logs-filter-panel">
          <div className="logs-filter-grid">
            <label className="logs-field">
              <span>Severity</span>
              <select value={severity} onChange={(e) => chooseSeverity(e.target.value as SeverityFilter)} disabled={errorFirst}>
                <option value="all">All severities</option>
                {SEVERITIES.map((sev) => <option key={sev} value={sev}>{sev}</option>)}
              </select>
            </label>
            <label className="logs-field">
              <span>Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {kindOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'All kinds' : kindLabel(item)}</option>)}
              </select>
            </label>
            <label className="logs-field">
              <span>Symbol</span>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="BTCUSDT" spellCheck={false} />
            </label>
            <label className="logs-field logs-field-wide">
              <span>Search</span>
              <IconSearch size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" spellCheck={false} />
            </label>
            <label className="logs-field">
              <span>Time range</span>
              <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)}>
                {TIME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="logs-field">
              <span>Decision</span>
              <select value={decision} onChange={(e) => setDecision(e.target.value as DecisionFilter)}>
                <option value="all">All decisions</option>
                <option value="accepted">Accepted only</option>
                <option value="rejected">Rejected only</option>
              </select>
            </label>
          </div>

          <div className="logs-filter-actions">
            <button type="button" className="logs-button" onClick={() => void load()} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
            <button type="button" className="logs-button" onClick={clearFilters} disabled={!canClear} title={!canClear ? 'No active filters to clear' : 'Reset all Logs filters'}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <div className="logs-workbench">
        <aside className="logs-facets" aria-label="Logs facets">
          <section className="logs-facet-panel">
            <div className="logs-facet-title">Severity</div>
            <div className="logs-incident-strip" aria-label="Incident severity counts">
              {SEVERITIES.map((sev) => (
                <IncidentButton
                  key={sev}
                  severity={sev}
                  count={severityCounts[sev]}
                  active={!errorFirst && severity === sev}
                  onClick={() => focusSeverity(sev)}
                />
              ))}
            </div>
          </section>

          <section className="logs-facet-panel">
            <div className="logs-facet-title">Kinds</div>
            <div className="logs-facet-list">
              {kindCounts.map(([item, count]) => (
                <button type="button" key={item} className={kind === item ? 'logs-active' : ''} onClick={() => setKind(item)}>
                  <span>{kindLabel(item)}</span>
                  <b>{count.toLocaleString('en-US')}</b>
                </button>
              ))}
            </div>
          </section>

          <section className="logs-facet-panel">
            <div className="logs-facet-title">Sources</div>
            <div className="logs-facet-list">
              {sourceCounts.map(([item, count]) => (
                <button type="button" key={item} className={query === item ? 'logs-active' : ''} onClick={() => setQuery(item)}>
                  <span>{sourceLabel(item)}</span>
                  <b>{count.toLocaleString('en-US')}</b>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="logs-table-shell">
          <div className="logs-table-head">
            <div>
              <h2>Event activity</h2>
              <span>Recent records from the event feed</span>
            </div>
            <div className="logs-table-head-meta">
              <span>{visible.length.toLocaleString('en-US')} rows</span>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No matching events">
              <button type="button" className="logs-button" onClick={clearFilters} disabled={!canClear}>
                Clear
              </button>
            </EmptyState>
          ) : (
            <div className="logs-event-list" role="listbox" aria-label="Event activity">
              {visible.map((ev) => {
                const evSeverity = eventSeverity(ev);
                const selectedRow = selected?.id === ev.id;
                return (
                  <div
                    key={ev.id}
                    className={`logs-event-item ${eventTone(ev)} ${selectedRow ? 'logs-selected' : ''}`}
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
                    <span className="logs-event-glyph">
                      {evSeverity === 'Critical' ? <IconAlert size={18} /> : evSeverity === 'Warning' ? <IconShield size={18} /> : evSeverity === 'Debug' ? <IconWifi size={18} /> : <IconReceipt size={18} />}
                    </span>
                    <span className="logs-event-copy">
                      <b>{eventTitle(ev)}</b>
                      <em>{eventCaption(ev)}</em>
                    </span>
                    <span className="logs-event-context">
                      <span>{fmtDateTime(ev.ts)}</span>
                      <em>{timeAgo(ev.ts)} · {kindLabel(ev.kind)} · {sourceLabel(sourceText(ev))}</em>
                    </span>
                    <span className="logs-event-token">
                      {ev.symbol ? (
                        <button type="button" className="logs-symbol" onClick={(e) => { e.stopPropagation(); inspectSymbol(ev.symbol as string); }} title={`Inspect ${ev.symbol} market detail`}>
                          <TokenIcon symbol={ev.symbol} size={18} />
                          <span className="logs-symbol-text">{ev.symbol}</span>
                        </button>
                      ) : (
                        <span className="logs-system-symbol">system</span>
                      )}
                    </span>
                    <span className="logs-event-state">
                      <SeverityPill severity={evSeverity} />
                      <b>{statusLabel(ev)}</b>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="logs-inspector">
          <div className="logs-inspector-head">
            <span className="logs-inspector-icon"><IconList size={16} /></span>
            <div>
              <h2>Event details</h2>
              <span>{selected ? `event #${selected.id}` : 'select a row'}</span>
            </div>
          </div>

          {selected ? (
            <>
              <div className={`logs-inspector-summary ${eventTone(selected)}`}>
                <SeverityPill severity={eventSeverity(selected)} />
                <strong>{eventTitle(selected)}</strong>
                <span>{kindLabel(selected.kind)}</span>
              </div>

              <dl className="logs-inspector-grid">
                <div>
                  <dt>ID</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{fmtDateTime(selected.ts)} · {timeAgo(selected.ts)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{sourceLabel(sourceText(selected))}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{eventCaption(selected)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(selected)}</dd>
                </div>
                <div>
                  <dt>Symbol</dt>
                  <dd>{selected.symbol ?? 'system'}</dd>
                </div>
                {selectedDetailFields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.key}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="logs-related">
                <span>Related navigation</span>
                {(() => {
                  const ids = relatedIds(selected);
                  const ctx = contextAction(selected);
                  return (
                    <>
                      {ids.proposalId ? (
                        <button type="button" className="logs-button" onClick={() => setPage('opportunities')}>
                          <IconChart size={14} />
                          Open proposal #{ids.proposalId}
                        </button>
                      ) : null}
                      {ids.orderId ? (
                        <button type="button" className="logs-button" onClick={() => setPage('orders')}>
                          <IconTicket size={14} />
                          Open order #{ids.orderId}
                        </button>
                      ) : null}
                      {!ids.proposalId && !ids.orderId ? (
                        <button type="button" className="logs-button" disabled title="This event does not carry an orderId or proposalId">
                          <IconBook size={14} />
                          No order/proposal id recorded
                        </button>
                      ) : null}
                      <button type="button" className="logs-button" onClick={() => setPage(ctx.page)}>
                        {ctx.page === 'system' ? <IconDatabase size={14} /> : ctx.page === 'risk' ? <IconShield size={14} /> : ctx.page === 'account' ? <IconWallet size={14} /> : <IconReceipt size={14} />}
                        {ctx.label}
                      </button>
                    </>
                  );
                })()}
              </div>

              <details className="logs-raw-drawer" open={rawOpen} onToggle={(e) => setRawOpen(e.currentTarget.open)}>
                <summary>Raw JSON drawer</summary>
                <pre>{safeJson(selected, 2)}</pre>
              </details>
            </>
          ) : (
            <span className="logs-empty-note">No matching events.</span>
          )}
        </aside>
      </div>
    </div>
  );
}
