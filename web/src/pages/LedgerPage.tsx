import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { KindChip, EmptyState } from '../components/ui';
import { eventSummary } from '../lib/eventText';
import { fmtDateTime, fmtPrice, timeAgo } from '../format';
import type { LedgerEvent } from '../types';
import { TokenIcon } from '../components/TokenIcon';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconClock,
  IconGear,
  IconList,
  IconPulse,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTicket,
  IconWallet,
  IconWifi,
} from '../components/Icons';

const KIND_GROUPS = [
  {
    title: 'Trading',
    kinds: ['order_intent', 'risk_decision', 'order_request', 'order_response', 'fill_event'],
  },
  {
    title: 'Control',
    kinds: ['manual_action', 'config_change', 'strategy_signal', 'loan_request', 'loan_response'],
  },
  {
    title: 'System',
    kinds: ['account_snapshot', 'binance.connected', 'user_stream', 'ws.open', 'ws.closed', 'engine.start', 'error_event'],
  },
];

const KNOWN_KINDS = ['all', ...KIND_GROUPS.flatMap((g) => g.kinds)];
const DETAIL_KEYS = [
  'action',
  'stage',
  'result',
  'status',
  'side',
  'type',
  'source',
  'allowed',
  'estNotionalUsd',
  'executedQuoteUsd',
  'orderId',
  'proposalId',
  'imported',
  'fetched',
  'feed',
  'message',
  'pairs',
  'assets',
  'mode',
];

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function kindLabel(kind: string): string {
  return kind
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function eventTone(ev: LedgerEvent): 'ok' | 'bad' | 'warn' | 'purple' | 'info' {
  const d = asRecord(ev.data);
  if (ev.kind.includes('error') || ev.kind === 'ws.closed') return 'bad';
  if (ev.kind === 'risk_decision') return d.allowed === true ? 'ok' : 'bad';
  if (ev.kind.startsWith('order') || ev.kind.startsWith('fill') || ev.kind.startsWith('loan')) return 'ok';
  if (ev.kind.startsWith('strategy')) return 'purple';
  if (ev.kind === 'manual_action' || ev.kind === 'config_change') return 'warn';
  return 'info';
}

function eventIcon(kind: string): ReactNode {
  if (kind === 'risk_decision') return <IconShield size={16} />;
  if (kind.startsWith('order')) return <IconTicket size={16} />;
  if (kind === 'fill_event') return <IconReceipt size={16} />;
  if (kind.startsWith('loan')) return <IconWallet size={16} />;
  if (kind === 'strategy_signal') return <IconChart size={16} />;
  if (kind === 'manual_action') return <IconPulse size={16} />;
  if (kind === 'config_change') return <IconGear size={16} />;
  if (kind.includes('error')) return <IconAlert size={16} />;
  if (kind.startsWith('ws') || kind === 'user_stream') return <IconWifi size={16} />;
  return <IconBook size={16} />;
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (/usd|notional|price|quote/i.test(key)) return fmtPrice(value);
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length} items`;
  try {
    const s = JSON.stringify(value);
    return s.length > 90 ? `${s.slice(0, 90)}...` : s;
  } catch {
    return String(value);
  }
}

function detailFields(ev: LedgerEvent): { key: string; value: string }[] {
  const d = asRecord(ev.data);
  return DETAIL_KEYS.filter((key) => key in d).map((key) => ({ key: kindLabel(key), value: formatDetailValue(key, d[key]) }));
}

function LedgerMetric({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon: ReactNode }) {
  return (
    <div className={`ledger-metric ${tone ?? ''}`}>
      <span className="ledger-metric-icon">{icon}</span>
      <span>
        <span className="ledger-metric-label">{label}</span>
        <span className="ledger-metric-value num">{value}</span>
        {sub && <span className="ledger-metric-sub">{sub}</span>}
      </span>
    </div>
  );
}

export function LedgerPage() {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [kind, setKind] = useState('all');
  const [symbol, setSymbol] = useState(() => {
    const v = sessionStorage.getItem('cosmos-ledger-symbol') ?? '';
    sessionStorage.removeItem('cosmos-ledger-symbol');
    return v;
  });
  const [q, setQ] = useState('');
  const [decision, setDecision] = useState<'all' | 'accepted' | 'rejected'>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copying, setCopying] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState<number | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '400' });
    if (kind !== 'all') params.set('kind', kind);
    if (/^[A-Z0-9]{5,20}$/.test(symbol)) params.set('symbol', symbol);
    if (q.trim()) params.set('q', q.trim());
    const url = `/api/events?${params}`;
    setLoading(true);
    return fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setEvents(d as LedgerEvent[]);
        setLoadError(null);
        setLastLoaded(Date.now());
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load events'))
      .finally(() => setLoading(false));
  }, [kind, symbol, q]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => events.filter((ev) => {
    if (decision === 'all') return true;
    const allowed = (ev.data as { allowed?: boolean } | null)?.allowed;
    if (allowed === undefined) return false;
    return decision === 'accepted' ? allowed : !allowed;
  }), [events, decision]);

  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of events) m.set(ev.kind, (m.get(ev.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const unknownKinds = useMemo(() => kindCounts.map(([k]) => k).filter((k) => !KNOWN_KINDS.includes(k)), [kindCounts]);
  const selected = visible.find((ev) => ev.id === expanded) ?? visible[0] ?? null;
  const errorCount = visible.filter((ev) => eventTone(ev) === 'bad').length;
  const riskRejected = visible.filter((ev) => ev.kind === 'risk_decision' && asRecord(ev.data).allowed === false).length;
  const executionCount = visible.filter((ev) => ev.kind.startsWith('order') || ev.kind === 'fill_event').length;
  const symbolCount = new Set(visible.map((ev) => ev.symbol).filter(Boolean)).size;
  const canClear = kind !== 'all' || symbol !== '' || q !== '' || decision !== 'all';

  async function copyEvent(ev: LedgerEvent): Promise<void> {
    const payload = JSON.stringify(ev, null, 2);
    setCopied(null);
    setCopyFailed(null);
    setCopying(ev.id);
    let ok = false;
    const nativeWrite = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (nativeWrite) {
      ok = await Promise.race([
        nativeWrite(payload).then(() => true).catch(() => false),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 300)),
      ]);
    }
    if (!ok) {
      const area = document.createElement('textarea');
      area.value = payload;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      area.style.top = '0';
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      } finally {
        area.remove();
      }
    }
    setCopying((id) => (id === ev.id ? null : id));
    setCopied(ok ? ev.id : null);
    setCopyFailed(ok ? null : ev.id);
    window.setTimeout(() => {
      setCopied((id) => (id === ev.id ? null : id));
      setCopyFailed((id) => (id === ev.id ? null : id));
    }, 1400);
  }

  function clearFilters(): void {
    setKind('all');
    setSymbol('');
    setQ('');
    setDecision('all');
    setExpanded(null);
  }

  return (
    <div className="container page ledger-page">
      <div className="ledger-hero">
        <div>
          <h1 className="page-title">Ledger / Logs</h1>
          <div className="page-sub">Every decision, order, fill, error and config change. Nothing is silent.</div>
        </div>
        <div className="ledger-live">
          <span className={`state-dot ${loadError ? 'bad' : loading ? 'warn' : 'ok'}`} />
          <span>{loadError ? loadError : loading ? 'syncing ledger' : `synced ${timeAgo(lastLoaded)}`}</span>
        </div>
      </div>

      <section className="ledger-metrics">
        <LedgerMetric label="Current view" value={visible.length.toLocaleString('en-US')} sub={`${symbolCount} symbols`} icon={<IconList size={16} />} />
        <LedgerMetric label="Latest event" value={selected ? timeAgo(selected.ts) : '-'} sub={selected ? kindLabel(selected.kind) : 'no events'} icon={<IconClock size={16} />} />
        <LedgerMetric label="Execution audit" value={executionCount.toLocaleString('en-US')} sub="orders and fills" tone="ok" icon={<IconReceipt size={16} />} />
        <LedgerMetric label="Rejected / errors" value={(riskRejected + errorCount).toLocaleString('en-US')} sub={`${riskRejected} risk rejects`} tone={riskRejected + errorCount > 0 ? 'bad' : 'ok'} icon={<IconShield size={16} />} />
      </section>

      <section className="card ledger-filter-card">
        <div className="ledger-filter-head">
          <div>
            <h2>Audit filters</h2>
            <span>Query is live. Backend search checks kind, symbol, and raw event data.</span>
          </div>
          <div className="ledger-filter-actions">
            <button className="mini-btn" onClick={() => void load()} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
            <button className="mini-btn" onClick={clearFilters} disabled={!canClear}>
              Clear
            </button>
          </div>
        </div>

        <div className="ledger-tools">
          <label className={`ledger-input ${symbol && !/^[A-Z0-9]{5,20}$/.test(symbol) ? 'warn' : ''}`}>
            <IconSearch size={14} />
            <span>Symbol</span>
            <input placeholder="BTCUSDT" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} spellCheck={false} />
          </label>
          <label className="ledger-input wide">
            <IconSearch size={14} />
            <span>Text</span>
            <input placeholder="risk, cancel, funding, error..." value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </label>
          <span className="seg ledger-decision">
            {(['all', 'accepted', 'rejected'] as const).map((d) => (
              <button key={d} className={decision === d ? 'on' : ''} onClick={() => setDecision(d)}>
                {d}
              </button>
            ))}
          </span>
        </div>

        <div className="ledger-kind-board">
          <button className={`ledger-kind-chip all ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>
            All events
            <b>{events.length}</b>
          </button>
          {KIND_GROUPS.map((group) => (
            <div className="ledger-kind-group" key={group.title}>
              <span>{group.title}</span>
              <div>
                {group.kinds.map((k) => (
                  <button key={k} className={`ledger-kind-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                    {kindLabel(k)}
                    <b>{kindCounts.find(([kk]) => kk === k)?.[1] ?? 0}</b>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {unknownKinds.length > 0 && (
            <div className="ledger-kind-group">
              <span>Other</span>
              <div>
                {unknownKinds.map((k) => (
                  <button key={k} className={`ledger-kind-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                    {kindLabel(k)}
                    <b>{kindCounts.find(([kk]) => kk === k)?.[1] ?? 0}</b>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {visible.length === 0 ? (
        <EmptyState title="No events for this filter">
          <button className="mini-btn" onClick={clearFilters} disabled={!canClear}>
            Clear filters
          </button>
        </EmptyState>
      ) : (
        <div className="ledger-layout">
          <section className="card ledger-stream-card">
            <div className="ledger-stream-head">
              <div>
                <h2>Audit stream</h2>
                <span>{visible.length.toLocaleString('en-US')} events shown from the current query</span>
              </div>
              <span className="chip-tag">{decision === 'all' ? 'all decisions' : decision}</span>
            </div>
            <div className="ledger-timeline">
              {visible.map((ev) => {
                const tone = eventTone(ev);
                const open = expanded === ev.id;
                const fields = detailFields(ev);
                return (
                  <article key={ev.id} className={`ledger-event ${tone} ${open ? 'open' : ''}`}>
                    <button className="ledger-event-main" onClick={() => setExpanded(open ? null : ev.id)} aria-expanded={open}>
                      <span className="ledger-rail">
                        <span className="ledger-dot" />
                      </span>
                      <span className="ledger-event-icon">{eventIcon(ev.kind)}</span>
                      <span className="ledger-event-body">
                        <span className="ledger-event-top">
                          <KindChip kind={ev.kind} />
                          <span className="ledger-time">{fmtDateTime(ev.ts)} · {timeAgo(ev.ts)}</span>
                        </span>
                        <strong>{eventSummary(ev.kind, ev.data as Record<string, unknown> | null, ev.symbol)}</strong>
                        <span className="ledger-event-meta">
                          {ev.symbol ? (
                            <span className="ledger-symbol">
                              <TokenIcon symbol={ev.symbol} size={20} />
                              {ev.symbol}
                            </span>
                          ) : (
                            <span className="ledger-symbol system">system</span>
                          )}
                          <span>#{ev.id}</span>
                          <span>{fields.length} fields</span>
                        </span>
                      </span>
                      <span className="ledger-open-mark">{open ? 'Hide' : 'Open'}</span>
                    </button>
                    {open && (
                      <div className="ledger-event-detail">
                        <div className="ledger-field-grid">
                          <span>
                            <b>Event ID</b>
                            <em>{ev.id}</em>
                          </span>
                          <span>
                            <b>Kind</b>
                            <em>{kindLabel(ev.kind)}</em>
                          </span>
                          <span>
                            <b>Symbol</b>
                            <em>{ev.symbol ?? 'system'}</em>
                          </span>
                          <span>
                            <b>Recorded</b>
                            <em>{fmtDateTime(ev.ts)}</em>
                          </span>
                          {fields.map((f) => (
                            <span key={f.key}>
                              <b>{f.key}</b>
                              <em>{f.value}</em>
                            </span>
                          ))}
                        </div>
                        <div className="ledger-json-head">
                          <span>Raw ledger payload</span>
                          <button className="mini-btn" onClick={() => void copyEvent(ev)}>
                            {copying === ev.id ? 'Copying' : copyFailed === ev.id ? 'Copy failed' : copied === ev.id ? 'Copied' : 'Copy JSON'}
                          </button>
                        </div>
                        <pre className="ledger-raw">{JSON.stringify(ev.data ?? {}, null, 2)}</pre>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="ledger-side">
            <section className="card ledger-inspector">
              <div className="ledger-inspector-head">
                <span className={`ledger-event-icon ${selected ? eventTone(selected) : ''}`}>{selected ? eventIcon(selected.kind) : <IconBook size={16} />}</span>
                <div>
                  <h2>{selected ? 'Selected event' : 'No event selected'}</h2>
                  <span>{selected ? `${fmtDateTime(selected.ts)} · ${timeAgo(selected.ts)}` : 'Open an event to inspect it'}</span>
                </div>
              </div>
              {selected ? (
                <>
                  <p>{eventSummary(selected.kind, selected.data as Record<string, unknown> | null, selected.symbol)}</p>
                  <div className="ledger-inspector-meta">
                    <span>
                      <b>Kind</b>
                      <em>{kindLabel(selected.kind)}</em>
                    </span>
                    <span>
                      <b>Symbol</b>
                      <em>{selected.symbol ?? 'system'}</em>
                    </span>
                    <span>
                      <b>Event ID</b>
                      <em>{selected.id}</em>
                    </span>
                  </div>
                  <button className="mini-btn wide" onClick={() => setExpanded(selected.id)}>
                    Open in stream
                  </button>
                </>
              ) : (
                <span className="ledger-side-empty">No matching ledger rows.</span>
              )}
            </section>

            <section className="card ledger-inspector">
              <div className="ledger-inspector-head">
                <span className="ledger-event-icon info"><IconList size={16} /></span>
                <div>
                  <h2>Kind breakdown</h2>
                  <span>Counts from the current backend query</span>
                </div>
              </div>
              <div className="ledger-count-list">
                {kindCounts.slice(0, 10).map(([k, count]) => (
                  <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                    <span>{kindLabel(k)}</span>
                    <b>{count}</b>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
