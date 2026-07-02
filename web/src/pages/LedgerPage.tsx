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

  useEffect(() => {
    const url = kind === 'all' ? '/api/events?limit=300' : `/api/events?limit=300&kind=${kind}`;
    const load = () =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setEvents(d as LedgerEvent[]))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [kind]);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ledger</h1>
          <div className="page-sub">Every action the system takes lands here — nothing is silent</div>
        </div>
      </div>

      <div className="chips" style={{ marginBottom: 6 }}>
        {KINDS.map((k) => (
          <button key={k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
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
              {events.map((ev) => (
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
