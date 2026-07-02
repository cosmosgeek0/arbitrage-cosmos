import { useState } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag } from '../components/ui';
import { fmtPrice, fmtDateTime, timeAgo } from '../format';

export function Orders() {
  const { state, cancelOrder } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <div className="card table-card">
      <div className="card-head">
        <b>Open orders</b>
        <span className="muted small">
          {state.openOrders.length} open · limit {state.config.maxOpenOrders}
        </span>
      </div>
      {msg && <div className="result-banner bad">{msg}</div>}
      {state.openOrders.length === 0 ? (
        <EmptyState title="No open orders">
          {state.binance.keysPresent
            ? 'Live orders appear here within seconds (user stream) or 30s (polling).'
            : 'Connect Binance keys to see and manage your orders.'}
        </EmptyState>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Price</th>
              <th>Qty (filled)</th>
              <th>Placed</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.openOrders.map((o) => (
              <tr key={o.orderId}>
                <td className="strong">{o.symbol}</td>
                <td>
                  <SideTag side={o.side} />
                </td>
                <td className="muted">{o.type}</td>
                <td className="num">{fmtPrice(o.price)}</td>
                <td className="num">
                  {o.origQty} ({o.executedQty})
                </td>
                <td className="muted small" title={fmtDateTime(o.time)}>
                  {timeAgo(o.time)} {o.stale && <span className="stale-flag">stale</span>}
                </td>
                <td className="muted small">{o.status}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      const res = await cancelOrder(o.symbol, o.orderId);
                      setMsg(res.ok ? null : (res.error ?? 'cancel failed'));
                    }}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
