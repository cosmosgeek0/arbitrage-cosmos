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
    <div className="card table-card">
      <div className="card-head">
        <b>Ledger</b>
        <select className="kind-select" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <EmptyState title="No events for this filter">Every action the system takes lands here — nothing is silent.</EmptyState>
      ) : (
        <table className="tbl ledger-tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Kind</th>
              <th>Symbol</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="muted small mono">{fmtDateTime(ev.ts)}</td>
                <td>
                  <KindChip kind={ev.kind} />
                </td>
                <td className="strong">{ev.symbol ?? '—'}</td>
                <td className="muted small mono ledger-data" title={ev.data != null ? JSON.stringify(ev.data, null, 1) : ''}>
                  {ev.data != null ? JSON.stringify(ev.data).slice(0, 140) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
