import { useState } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPrice, fmtQty, fmtDateTime, timeAgo } from '../format';

interface HistOrder {
  symbol: string;
  orderId: number;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  time: number;
}

export function Orders() {
  const { state, cancelOrder, cancelAll, openLedger } = useStore();
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [histSymbol, setHistSymbol] = useState('BTCUSDT');
  const [hist, setHist] = useState<HistOrder[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadHistory = async () => {
    setHistErr(null);
    setHist(null);
    try {
      const res = await fetch(`/api/orders/history?symbol=${histSymbol}`);
      const d = (await res.json()) as { available: boolean; error?: string; orders: HistOrder[] };
      if (!d.available) setHistErr(d.error ?? 'unavailable');
      setHist(d.orders);
    } catch {
      setHistErr('network error');
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Orders</h1>
          <div className="page-sub">
            {state?.openOrders.length ?? 0} open · limit {state?.config.maxOpenOrders}
          </div>
        </div>
      </div>

      <div className="atabs">
        <button className={`atab ${tab === 'open' ? 'on' : ''}`} onClick={() => setTab('open')}>
          Open
        </button>
        <button className={`atab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {msg && <div className="result-strip bad">{msg}</div>}

      {tab === 'open' ? (
        (state?.openOrders.length ?? 0) === 0 ? (
          <EmptyState title="No open orders">
            {state?.binance.keysPresent
              ? 'Live orders appear within seconds (user stream) or 30s (polling).'
              : 'Connect Binance keys to see and manage orders.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mkt">
              <thead>
                <tr>
                  <th className="l">Symbol</th>
                  <th className="l">Side</th>
                  <th className="l">Type</th>
                  <th>Price</th>
                  <th>Qty (filled)</th>
                  <th>Placed</th>
                  <th className="l col-hide-sm">Client id</th>
                  <th className="l">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state!.openOrders.map((o) => (
                  <tr key={o.orderId}>
                    <td className="l">
                      <span className="tok">
                        <TokenIcon symbol={o.symbol} size={26} />
                        <span className="tok-name">{o.symbol}</span>
                      </span>
                    </td>
                    <td className="l">
                      <SideTag side={o.side} />
                    </td>
                    <td className="l muted">{o.type}</td>
                    <td className="val-strong">
                      <span className="num">{fmtPrice(o.price)}</span>
                    </td>
                    <td>
                      <span className="num">
                        {fmtQty(o.origQty)} ({fmtQty(o.executedQty)})
                      </span>
                    </td>
                    <td className="muted" title={fmtDateTime(o.time)}>
                      {timeAgo(o.time)} {o.stale && <span className="chip-tag gold">stale</span>}
                    </td>
                    <td className="l muted small mono col-hide-sm" title={o.clientOrderId ?? ''}>
                      {(o.clientOrderId ?? '—').slice(0, 12)}
                    </td>
                    <td className="l muted">{o.status}</td>
                    <td>
                      <button
                        className="mini-btn"
                        onClick={async () => {
                          const res = await cancelOrder(o.symbol, o.orderId);
                          setMsg(res.ok ? null : (res.error ?? 'cancel failed'));
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="mini-btn"
                        style={{ marginLeft: 6 }}
                        title={`Every decision and Binance response for ${o.symbol}`}
                        onClick={() => openLedger(o.symbol)}
                      >
                        Ledger
                      </button>
                      <button
                        className="mini-btn"
                        style={{ marginLeft: 6 }}
                        title={`Cancel ALL open ${o.symbol} orders`}
                        onClick={async () => {
                          const res = await cancelAll(o.symbol);
                          setMsg(res.ok ? null : (res.error ?? 'cancel-all failed'));
                        }}
                      >
                        All
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          <div className="table-tools">
            <div className="tsearch">
              <input value={histSymbol} onChange={(e) => setHistSymbol(e.target.value.toUpperCase())} spellCheck={false} />
            </div>
            <button className="cta-pill" onClick={() => void loadHistory()}>
              Load history
            </button>
            <span className="sec-note">Binance order history is per-symbol (last 100)</span>
          </div>
          {histErr && <div className="result-strip bad">{histErr}</div>}
          {hist === null ? (
            <EmptyState title="Pick a symbol and load">History comes straight from Binance, per symbol.</EmptyState>
          ) : hist.length === 0 ? (
            <EmptyState title={`No orders for ${histSymbol}`} />
          ) : (
            <div className="table-scroll">
              <table className="mkt dense">
                <thead>
                  <tr>
                    <th className="l">Time</th>
                    <th className="l">Side</th>
                    <th className="l">Type</th>
                    <th>Price</th>
                    <th>Qty (filled)</th>
                    <th className="l">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.map((o) => (
                    <tr key={o.orderId}>
                      <td className="l muted">{fmtDateTime(o.time)}</td>
                      <td className="l">
                        <SideTag side={o.side} />
                      </td>
                      <td className="l muted">{o.type}</td>
                      <td>
                        <span className="num">{fmtPrice(Number(o.price))}</span>
                      </td>
                      <td>
                        <span className="num">
                          {fmtQty(Number(o.origQty))} ({fmtQty(Number(o.executedQty))})
                        </span>
                      </td>
                      <td className="l">
                        <span className={`chip-tag ${o.status === 'FILLED' ? 'ok' : o.status === 'CANCELED' ? '' : 'gold'}`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
