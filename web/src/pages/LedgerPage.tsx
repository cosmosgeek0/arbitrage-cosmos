import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, type Page } from '../store';
import { Empty, Pill, type Tone } from '../components/px';
import { eventSummary } from '../lib/eventText';
import { fmtPrice, timeAgo } from '../format';
import { TIME_ZONE_OPTIONS, addDays, dayBounds, dayKey, formatKey, resolvedZoneLabel } from '../lib/time';
import type { LedgerEvent } from '../types';
import { TokenIcon } from '../components/TokenIcon';
import { PillSelect } from '../components/PillSelect';
import {
  IconChart,
  IconDatabase,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTicket,
  IconWallet,
} from '../components/Icons';
import './LiveIntelligence.css';

type Severity = 'Critical' | 'Warning' | 'Info' | 'Debug';
type SeverityFilter = 'all' | Severity;
type DecisionFilter = 'all' | 'accepted' | 'rejected';

const SEVERITY_TONE: Record<Severity, Tone> = {
  Critical: 'bad',
  Warning: 'warn',
  Info: 'idle',
  Debug: 'idle',
};
const SEVERITY_FILTERS: { id: SeverityFilter; label: string }[] = [
  { id: 'all', label: 'All Logs' },
  { id: 'Critical', label: 'Critical' },
  { id: 'Warning', label: 'Warning' },
  { id: 'Info', label: 'Info' },
  { id: 'Debug', label: 'Debug' },
];
const LOG_PAGE_SIZES = [25, 50, 100] as const;

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

function formatLogTime(ts: number, zone?: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
}

function formatLogDateTime(ts: number, zone?: string): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function severityCounts(events: LedgerEvent[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { Critical: 0, Warning: 0, Info: 0, Debug: 0 };
  for (const event of events) counts[eventSeverity(event)] += 1;
  return counts;
}

function SeverityBars({ severity }: { severity: Severity }) {
  return <span className={`logx-severity-bars ${severity.toLowerCase()}`} aria-label={`${severity} Severity`} title={`${severity} Severity`}>
    <i /><i /><i />
  </span>;
}

export function LedgerPage() {
  const { setPage, openDetail, state, prefs, updatePref } = useStore();
  const zone = prefs.clockZone && prefs.clockZone !== 'local' ? prefs.clockZone : undefined;
  const today = dayKey(new Date(), zone);
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)), [today]);
  const stateEvents = state?.events ?? [];
  const [apiEvents, setApiEvents] = useState<LedgerEvent[]>(() => stateEvents);
  const [selectedDay, setSelectedDay] = useState(today);
  const [kind, setKind] = useState('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [symbol, setSymbol] = useState(() => {
    const v = sessionStorage.getItem('cosmos-ledger-symbol') ?? '';
    sessionStorage.removeItem('cosmos-ledger-symbol');
    return v;
  });
  const [query, setQuery] = useState('');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [showDebug, setShowDebug] = useState(false);
  const [pageSize, setPageSize] = useState<number>(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [dayTotals, setDayTotals] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (stateEvents.length && apiEvents.length === 0) setApiEvents(stateEvents);
  }, [apiEvents.length, stateEvents]);

  useEffect(() => {
    setSelectedDay(today);
    setSelectedId(null);
  }, [prefs.clockZone, today]);

  const load = useCallback(() => {
    const bounds = dayBounds(selectedDay, zone);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(pageIndex * pageSize),
      since: String(bounds.since),
      until: String(bounds.until),
    });
    if (kind !== 'all') params.set('kind', kind);
    if (symbol.trim()) params.set('symbol', symbol.trim().toUpperCase());
    if (query.trim()) params.set('q', query.trim());

    setLoading(true);
    return Promise.all([
      fetch(`/api/events?${params}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch(`/api/events/count?${params}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ])
      .then(([payload, countPayload]) => {
        setApiEvents(Array.isArray(payload) ? payload as LedgerEvent[] : []);
        setTotalCount(Number(countPayload?.count) || 0);
        setLoadError(null);
        setLastLoaded(Date.now());
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load events'))
      .finally(() => setLoading(false));
  }, [kind, pageIndex, pageSize, query, selectedDay, symbol, zone]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), Math.max(30, prefs.dataCadence?.health ?? 10) * 1000);
    return () => window.clearInterval(t);
  }, [load, prefs.dataCadence?.health]);

  useEffect(() => {
    let live = true;
    const readTotals = async () => {
      const pairs = await Promise.all(dayKeys.map(async (key) => {
        const bounds = dayBounds(key, zone);
        const params = new URLSearchParams({ since: String(bounds.since), until: String(bounds.until) });
        const response = await fetch(`/api/events/count?${params}`, { cache: 'no-store' });
        const payload = response.ok ? await response.json() as { count?: number } : {};
        return [key, Number(payload.count) || 0] as const;
      }));
      if (live) setDayTotals(Object.fromEntries(pairs));
    };
    void readTotals();
    const timer = window.setInterval(() => void readTotals(), 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [dayKeys, zone]);

  const events = useMemo(() => {
    const map = new Map<number, LedgerEvent>();
    for (const ev of apiEvents) map.set(ev.id, ev);
    return sortEvents([...map.values()]);
  }, [apiEvents]);

  const kindOptions = useMemo(() => {
    const seen = new Set([...KNOWN_KINDS, ...events.map((ev) => ev.kind)]);
    return ['all', ...[...seen].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)))];
  }, [events]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, LedgerEvent[]>(dayKeys.map((key) => [key, []]));
    for (const event of events) {
      const key = dayKey(new Date(event.ts), zone);
      map.get(key)?.push(event);
    }
    return map;
  }, [dayKeys, events, zone]);

  const selectedDayEvents = itemsByDay.get(selectedDay) ?? [];

  const baseEvents = useMemo(() => {
    const symbolQuery = symbol.trim().toUpperCase();
    return selectedDayEvents.filter((ev) => {
      if (kind !== 'all' && ev.kind !== kind) return false;
      if (symbolQuery && !(ev.symbol ?? '').toUpperCase().includes(symbolQuery)) return false;
      if (!eventMatchesText(ev, query)) return false;
      if (decision !== 'all' && decisionState(ev) !== decision) return false;
      return true;
    });
  }, [decision, kind, query, selectedDayEvents, symbol]);

  const selectedCounts = useMemo(() => severityCounts(selectedDayEvents), [selectedDayEvents]);

  const visible = useMemo(() => baseEvents.filter((ev) => {
    const evSeverity = eventSeverity(ev);
    if (severity !== 'all') return evSeverity === severity;
    if (!showDebug && evSeverity === 'Debug') return false;
    return true;
  }), [baseEvents, severity, showDebug]);

  const renderedEvents = visible;

  const selected = selectedId === null ? null : visible.find((ev) => ev.id === selectedId) ?? null;
  const debugHiddenCount = showDebug ? 0 : selectedCounts.Debug;
  const canClear = kind !== 'all' || severity !== 'all' || symbol !== '' || query !== '' || decision !== 'all' || showDebug;
  const rangeLabel = `${formatKey(dayKeys[0], { month: 'short', day: 'numeric' })} — ${formatKey(dayKeys[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  useEffect(() => {
    setRawOpen(false);
  }, [selected?.id]);

  useEffect(() => {
    setPageIndex(0);
  }, [decision, kind, pageSize, query, selectedDay, severity, showDebug, symbol]);

  function clearFilters(): void {
    setKind('all');
    setSeverity('all');
    setSymbol('');
    setQuery('');
    setDecision('all');
    setShowDebug(false);
    setSelectedId(null);
  }

  function selectSeverity(next: SeverityFilter): void {
    setSeverity(next);
    setSelectedId(null);
    if (next === 'Debug') setShowDebug(true);
  }

  return (
    <div className="container page lix-page logx-page">
      <div className="lix-frame logx-frame">
        <header className="lix-toolbar">
          <div className="lix-title logx-title">
            <img className="logx-page-mark" src="/log-mark.png" alt="" aria-hidden="true" />
            <h1>Logs</h1>
            <span className={`lix-live ${loadError ? 'error' : ''}`}>
              <i />
              {loadError ? 'Unavailable' : loading ? 'Updating' : `Live · ${lastLoaded ? timeAgo(lastLoaded) : stateEvents.length ? 'Cached' : 'Waiting'}`}
            </span>
          </div>
          <label className="lix-search">
            <IconSearch size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" spellCheck={false} />
            {query && <button type="button" aria-label="Clear Search" onClick={() => setQuery('')}>×</button>}
          </label>
        </header>

        <section className="calx-navigation logx-navigation" aria-label="Logs Navigation">
          <div className="calx-range-controls">
            <button type="button" className="calx-today" onClick={() => { setSelectedDay(today); setSelectedId(null); }}>Today</button>
            <strong>{rangeLabel}</strong><span className="newsx-range-note">Rolling Seven Days</span>
          </div>
          <PillSelect value={prefs.clockZone} options={TIME_ZONE_OPTIONS.map((option) => ({ ...option }))} onChange={(value) => updatePref('clockZone', value)} ariaLabel="Time Zone" className="lix-select lix-zone-select" />
        </section>

        <section className="calx-week logx-week" aria-label="Log Days">
          {dayKeys.map((key) => {
            const rows = itemsByDay.get(key) ?? [];
            const counts = severityCounts(rows);
            return <button type="button" key={key} aria-pressed={key === selectedDay} className={`${key === selectedDay ? 'selected' : ''} ${key === today ? 'today' : ''}`} onClick={() => { setSelectedDay(key); setSelectedId(null); }}>
              <span className="calx-day-name">{formatKey(key, { weekday: 'short' })} <b>{formatKey(key, { day: 'numeric' })}</b></span>
              <span><em>Logs</em><b>{dayTotals[key] ?? '—'}</b></span>
              <span className="logx-day-severity"><em>{key === selectedDay ? 'Current Page' : 'Select Day'}</em><b>{key === selectedDay ? <><i className="critical">C {counts.Critical}</i><i className="warning">W {counts.Warning}</i><i className="info">I {counts.Info}</i><i className="debug">D {counts.Debug}</i></> : <i className="info">{dayTotals[key] ?? '—'} Total</i>}</b></span>
            </button>;
          })}
        </section>

        <section className="lix-filters logx-filters" aria-label="Logs Filters">
          <div className="lix-segments logx-severity-tabs" role="group" aria-label="Severity">
            {SEVERITY_FILTERS.map((option) => <button type="button" key={option.id} aria-pressed={severity === option.id} className={severity === option.id ? 'selected' : ''} onClick={() => selectSeverity(option.id)}>{option.label}</button>)}
          </div>
          <div className="logx-filter-actions">
            <PillSelect
              value={kind}
              options={kindOptions.map((item) => ({ id: item, label: item === 'all' ? 'All Kinds' : kindLabel(item) }))}
              onChange={(value) => { setKind(value); setSelectedId(null); }}
              ariaLabel="Kind Filter"
              className="lix-select"
            />
            <PillSelect
              value={decision}
              options={[
                { id: 'all' as DecisionFilter, label: 'All Decisions' },
                { id: 'accepted' as DecisionFilter, label: 'Accepted Only' },
                { id: 'rejected' as DecisionFilter, label: 'Rejected Only' },
              ]}
              onChange={(value) => { setDecision(value); setSelectedId(null); }}
              ariaLabel="Decision Filter"
              className="lix-select"
            />
            <PillSelect
              value={String(pageSize)}
              options={LOG_PAGE_SIZES.map((count) => ({ id: String(count), label: `${count} Per Page` }))}
              onChange={(value) => setPageSize(Number(value))}
              ariaLabel="Logs Per Page"
              className="lix-select"
            />
            {symbol && <button type="button" className="logx-symbol-chip" onClick={() => setSymbol('')} title={`Clear ${symbol} filter`}>{symbol}<span>×</span></button>}
            <button
              type="button"
              className={`logx-debug-toggle${showDebug ? ' active' : ''}`}
              aria-pressed={showDebug}
              title={showDebug ? 'Debug and connection records are visible' : `${debugHiddenCount.toLocaleString('en-US')} debug records hidden`}
              onClick={() => { setShowDebug((current) => !current); setSelectedId(null); }}
            >
              {showDebug ? 'Debug On' : 'Include Debug'}
            </button>
            <button type="button" className="logx-refresh" onClick={() => void load()} disabled={loading}>
              <IconRefresh size={13} />
              Refresh
            </button>
            {canClear && <button type="button" className="logx-clear" onClick={clearFilters}>Clear</button>}
          </div>
        </section>

        <section className="logx-tape" aria-label="Log Activity">
          <div className="logx-day-header">
            <strong>{formatKey(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
            <span>{selectedDayEvents.length} Logs · {selectedCounts.Critical} Critical · {selectedCounts.Warning} Warning · {selectedCounts.Info} Info · {selectedCounts.Debug} Debug · {resolvedZoneLabel(prefs.clockZone)}</span>
          </div>
          <div className="logx-header"><span>Time</span><span>Severity</span><span>Event</span><span>Symbol</span><span>Source</span><span>Status</span><span /></div>
          <div className="logx-day-body" key={selectedDay} role="listbox" aria-label="Log Activity">
            {renderedEvents.map((ev) => {
              const evSeverity = eventSeverity(ev);
              const expanded = selected?.id === ev.id;
              const fields = detailFields(ev);
              const ids = relatedIds(ev);
              const ctx = contextAction(ev);
              return <div className={`logx-entry${expanded ? ' expanded' : ''}`} key={ev.id}>
                <div
                  className={`lg-row${expanded ? ' selected' : ''}`}
                  onClick={() => setSelectedId((current) => current === ev.id ? null : ev.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId((current) => current === ev.id ? null : ev.id);
                    }
                  }}
                  role="option"
                  tabIndex={0}
                  aria-selected={expanded}
                  aria-expanded={expanded}
                >
                  <span className="lg-time" title={formatLogDateTime(ev.ts, zone)}>{formatLogTime(ev.ts, zone)}</span>
                  <SeverityBars severity={evSeverity} />
                  <span className="lg-main" title={`${eventTitle(ev)} — ${eventCaption(ev)}`}>
                    <b>{eventTitle(ev)}</b>
                    <em> — {eventCaption(ev)}</em>
                  </span>
                  {ev.symbol ? (
                    <button
                      type="button"
                      className="lg-sym"
                      onClick={(event) => { event.stopPropagation(); openDetail(ev.symbol as string); }}
                      title={`Inspect ${ev.symbol} market detail`}
                    >
                      <TokenIcon symbol={ev.symbol} size={14} />
                      {ev.symbol}
                    </button>
                  ) : (
                    <span className="lg-sym system">System</span>
                  )}
                  <span className="lg-src" title={`${kindLabel(ev.kind)} · ${sourceLabel(sourceText(ev))}`}>{sourceLabel(sourceText(ev))}</span>
                  <span className="lg-status">{statusLabel(ev)}</span>
                  <span className={`logx-expand${expanded ? ' open' : ''}`} aria-hidden>
                    <svg viewBox="0 0 16 16"><path d="M4.5 6.25 8 9.75l3.5-3.5" /></svg>
                  </span>
                </div>
                {expanded && <div className="logx-detail">
                  <div className="logx-detail-head">
                    <div><Pill tone={SEVERITY_TONE[evSeverity]}>{evSeverity}</Pill><strong>{eventTitle(ev)}</strong><span>#{ev.id} · {kindLabel(ev.kind)}</span></div>
                    <time>{formatLogDateTime(ev.ts, zone)} · {timeAgo(ev.ts)}</time>
                  </div>
                  <dl className="lg-facts">
                    <div><dt>Source</dt><dd>{sourceLabel(sourceText(ev))}</dd></div>
                    <div><dt>Reason</dt><dd>{eventCaption(ev)}</dd></div>
                    <div><dt>Status</dt><dd>{statusLabel(ev)}</dd></div>
                    <div><dt>Symbol</dt><dd>{ev.symbol ?? 'System'}</dd></div>
                    {fields.map((field) => <div key={field.key}><dt>{field.key}</dt><dd>{field.value}</dd></div>)}
                  </dl>
                  <div className="lg-related">
                    {ids.proposalId && <button type="button" className="hp-btn" onClick={() => setPage('opportunities')}><IconChart size={13} />Open Proposal #{ids.proposalId}</button>}
                    {ids.orderId && <button type="button" className="hp-btn" onClick={() => setPage('orders')}><IconTicket size={13} />Open Order #{ids.orderId}</button>}
                    <button type="button" className="hp-btn" onClick={() => setPage(ctx.page)}>
                      {ctx.page === 'system' ? <IconDatabase size={13} /> : ctx.page === 'risk' ? <IconShield size={13} /> : ctx.page === 'account' ? <IconWallet size={13} /> : <IconReceipt size={13} />}
                      {ctx.label}
                    </button>
                  </div>
                  <details className="lg-raw" open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}>
                    <summary>Raw JSON</summary>
                    <pre>{safeJson(ev, 2)}</pre>
                  </details>
                </div>}
              </div>;
            })}
            {totalCount > pageSize && <div className="logx-load-more">
              <span>Showing {(pageIndex * pageSize + 1).toLocaleString('en-US')}–{Math.min((pageIndex + 1) * pageSize, totalCount).toLocaleString('en-US')} Of {totalCount.toLocaleString('en-US')} Logs</span>
              <span className="logx-page-actions">
                <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>Newer</button>
                <button type="button" disabled={(pageIndex + 1) * pageSize >= totalCount} onClick={() => setPageIndex((current) => current + 1)}>Older</button>
              </span>
            </div>}
            {loading && events.length === 0 && <div className="lix-empty">Loading Logs…</div>}
            {loadError && events.length === 0 && <div className="lix-empty">The Log Feed Is Currently Unavailable.</div>}
            {!loading && !loadError && visible.length === 0 && <div className="lix-empty">{query ? `Nothing Matches “${query}”.` : 'No Logs Match These Filters.'}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
