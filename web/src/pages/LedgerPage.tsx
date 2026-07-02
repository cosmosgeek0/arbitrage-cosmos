import { useEffect, useState } from 'react';
import { KindChip, EmptyState } from '../components/ui';
import { fmtDateTime } from '../format';
import type { LedgerEvent } from '../types';

const KINDS = [
  'all',
  'order_intent',
  'risk_decision',
  'order_request',
  'order_response',
  'fill_event',
  'loan_request',
  'loan_response',
  'strategy_signal',
  'manual_action',
  'account_snapshot',
  'config_change',
  'error_event',
];

export function LedgerPage() {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [kind, setKind] = useState('all');
  const [symbol, setSymbol] = useState('');
  const [q, setQ] = useState('');
  const [decision, setDecision] = useState<'all' | 'accepted' | 'rejected'>('all');

  useEffect(() => {
    const params = new URLSearchParams({ limit: '400' });
    if (kind !== 'all') params.set('kind', kind);
    if (/^[A-Z0-9]{5,20}$/.test(symbol)) params.set('symbol', symbol);
    if (q.trim()) params.set('q', q.trim());
    const url = `/api/events?${params}`;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setEvents(d as LedgerEvent[]))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [kind, symbol, q]);

  const visible = events.filter((ev) => {
    if (decision === 'all') return true;
    const allowed = (ev.data as { allowed?: boolean } | null)?.allowed;
    if (allowed === undefined) return false;
    return decision === 'accepted' ? allowed : !allowed;
  });

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ledger / Logs</h1>
          <div className="page-sub">Every decision, order, fill, error and config change — nothing is silent</div>
        </div>
        <div className="head-actions">
          <div className="tsearch">
            <input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} spellCheck={false} style={{ width: 90 }} />
          </div>
          <div className="tsearch">
            <input placeholder="Search text…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </div>
          <span className="seg">
            {(['all', 'accepted', 'rejected'] as const).map((d) => (
              <button key={d} className={decision === d ? 'on' : ''} onClick={() => setDecision(d)}>
                {d}
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 6 }}>
        {KINDS.map((k) => (
          <button key={k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No events for this filter" />
      ) : (
        <div className="table-scroll">
          <table className="mkt dense">
            <thead>
              <tr>
                <th className="l">Time</th>
                <th className="l">Kind</th>
                <th className="l">Symbol</th>
                <th className="l">Data</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id}>
                  <td className="l muted mono small">{fmtDateTime(ev.ts)}</td>
                  <td className="l">
                    <KindChip kind={ev.kind} />
                  </td>
                  <td className="l val-strong">{ev.symbol ?? '—'}</td>
                  <td className="l muted mono small" style={{ maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis' }} title={ev.data != null ? JSON.stringify(ev.data, null, 1) : ''}>
                    {ev.data != null ? JSON.stringify(ev.data).slice(0, 150) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
