import { useState } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { EmptyState, SetupChecklist, SideTag, KindChip, WarnStrip, StatusDot } from '../components/ui';
import { fmtPrice, fmtPct, fmtQty, timeAgo, fmtTimeShort, signClass, baseOf } from '../format';

export function Dashboard() {
  const { state, setPage, openTicket, openDetail } = useStore();
  const [quickSymbol, setQuickSymbol] = useState('BTCUSDT');

  if (!state) return <div className="container page"><div className="empty-state">Connecting to engine…</div></div>;

  const acct = state.account;
  const exposure = state.positions.reduce((s, p) => s + p.valueUsdt, 0);
  const dayPct =
    acct && acct.dayOpenEquity && acct.dayOpenEquity > 0 && acct.dayChangeUsd !== null
      ? (acct.dayChangeUsd / acct.dayOpenEquity) * 100
      : null;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-sub">
            Private Binance control room · {state.scanner.pairs} pairs scanned ·{' '}
            {state.binance.keysPresent
              ? state.binance.connected
                ? `account synced ${timeAgo(state.binance.lastSyncTs)}`
                : 'account sync failing'
              : 'account not connected'}
          </div>
        </div>
        <div className="head-actions">
          <button className="cta-pill" onClick={() => setPage('trade')}>
            New order
          </button>
        </div>
      </div>

      {state.binance.canWithdraw === true && (
        <WarnStrip>
          This API key can WITHDRAW. The app never withdraws, but the key should not have that power — recreate it
          with withdrawals disabled.
        </WarnStrip>
      )}
      {state.binance.keysPresent && !state.binance.connected && (
        <WarnStrip>Account sync failing: {state.binance.lastError ?? 'unknown error'}</WarnStrip>
      )}

      <div className="headline">
        {acct ? (
          <Num value={acct.totalUsdt} className="headline-val">
            {fmtPrice(acct.totalUsdt)}
          </Num>
        ) : (
          <span className="headline-val faint" style={{ fontSize: 34 }}>
            Not connected
          </span>
        )}
        <span className="headline-unit">total equity</span>
        {acct?.dayChangeUsd !== null && acct?.dayChangeUsd !== undefined && (
          <span className={`hl-chip num ${signClass(acct.dayChangeUsd)}`}>
            {acct.dayChangeUsd >= 0 ? '+' : ''}
            {acct.dayChangeUsd.toFixed(2)} {dayPct !== null ? `(${fmtPct(dayPct, 2)})` : ''} today
          </span>
        )}
      </div>

      <div className="metric-strip">
        <div className="metric">
          <span className="k">Available USDT</span>
          <span className="v num">{acct ? fmtPrice(acct.availableUsdt) : '—'}</span>
          <span className="s">free, not in orders</span>
        </div>
        <div className="metric">
          <span className="k">Realized today</span>
          <span className={`v num ${acct ? signClass(acct.realizedTodayUsd) : ''}`}>
            {acct ? fmtPrice(acct.realizedTodayUsd) : '—'}
          </span>
          <span className="s">from ledgered fills</span>
        </div>
        <div className="metric">
          <span className="k">Open exposure</span>
          <span className="v num">{acct ? fmtPrice(exposure) : '—'}</span>
          <span className="s">
            {state.openOrders.length} open order{state.openOrders.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="metric">
          <span className="k">Daily notional used</span>
          <span className="v num">{fmtPrice(state.risk.dailyNotionalUsedUsd)}</span>
          <span className="s">of ${state.config.maxDailyNotionalUsd} limit</span>
        </div>
        <div className="metric">
          <span className="k">Mode</span>
          <span className={`v ${state.mode === 'HALTED' ? 'down' : state.mode === 'LIVE_ARMED' ? 'up' : ''}`}>
            {state.mode === 'LIVE_ARMED' ? 'LIVE ARMED' : state.mode}
          </span>
          <span className="s">change on Risk page</span>
        </div>
      </div>

      {!state.binance.keysPresent && (
        <div className="ghost-tile">
          <StatusDot status="none" />
          <div>
            <div className="gt-title">Binance account not connected</div>
            <div className="gt-sub">
              Public market data is live. Add read-only keys on the server to see balances, orders and fills here.
            </div>
            <SetupChecklist />
          </div>
          <span className="gt-badge">setup</span>
        </div>
      )}

      <div className="two-col" style={{ marginTop: 10 }}>
        <div>
          <div className="sec-head">
            <h2 className="sec-title">Open orders</h2>
            <button className="sec-link" onClick={() => setPage('orders')}>
              View all →
            </button>
          </div>
          {state.openOrders.length === 0 ? (
            <EmptyState title="No open orders">
              {state.binance.keysPresent ? 'Orders appear here live within seconds.' : 'Connect Binance to manage orders.'}
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="mkt dense">
                <thead>
                  <tr>
                    <th className="l">Symbol</th>
                    <th className="l">Side</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {state.openOrders.slice(0, 6).map((o) => (
                    <tr key={o.orderId} className="rowlink" onClick={() => setPage('orders')}>
                      <td className="l val-strong">{o.symbol}</td>
                      <td className="l">
                        <SideTag side={o.side} />
                      </td>
                      <td>
                        <span className="num">{fmtPrice(o.price)}</span>
                      </td>
                      <td>
                        <span className="num">{fmtQty(o.origQty)}</span>
                      </td>
                      <td className="muted">
                        {timeAgo(o.time)} {o.stale && <span className="chip-tag gold">stale</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sec-head">
            <h2 className="sec-title">Recent fills</h2>
            <button className="sec-link" onClick={() => setPage('fills')}>
              View all →
            </button>
          </div>
          {state.recentFills.length === 0 ? (
            <EmptyState title="No fills recorded yet">
              Fills stream in live from the moment Binance connects. Import history per symbol on the Fills page.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="mkt dense">
                <thead>
                  <tr>
                    <th className="l">Symbol</th>
                    <th className="l">Side</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Value</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {state.recentFills.slice(0, 6).map((f) => (
                    <tr key={`${f.symbol}-${f.tradeId}`}>
                      <td className="l val-strong">{f.symbol}</td>
                      <td className="l">
                        <SideTag side={f.side} />
                      </td>
                      <td>
                        <span className="num">{fmtPrice(f.price)}</span>
                      </td>
                      <td>
                        <span className="num">{fmtQty(f.qty)}</span>
                      </td>
                      <td>
                        <span className="num">{fmtPrice(f.quoteQty)}</span>
                      </td>
                      <td className="muted">{timeAgo(f.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sec-head">
            <h2 className="sec-title">Event timeline</h2>
            <button className="sec-link" onClick={() => setPage('ledger')}>
              Full ledger →
            </button>
          </div>
          <div>
            {state.events.slice(0, 10).map((ev) => (
              <div key={ev.id} className="drow">
                <span className="faint num small">{fmtTimeShort(ev.ts)}</span>
                <KindChip kind={ev.kind} />
                {ev.symbol && <span className="strong small">{ev.symbol}</span>}
                <span className="muted small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {ev.data != null ? JSON.stringify(ev.data).slice(0, 90) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rail">
          <div className="rail-sec">
            <div className="rail-head">
              <span className="rail-title">Quick trade</span>
            </div>
            <div className="fld" style={{ marginTop: 8 }}>
              <span>Symbol</span>
              <input value={quickSymbol} onChange={(e) => setQuickSymbol(e.target.value.toUpperCase())} spellCheck={false} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="cta-pill buy" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openTicket({ symbol: quickSymbol, side: 'BUY', source: 'manual' })}>
                Buy
              </button>
              <button className="cta-pill danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openTicket({ symbol: quickSymbol, side: 'SELL', source: 'manual' })}>
                Sell
              </button>
            </div>
            <div className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Every send passes the risk gate and a typed confirmation.
            </div>
          </div>

          <div className="rail-sec">
            <div className="rail-head">
              <span className="rail-title">Strategies</span>
              <button className="sec-link" onClick={() => setPage('strategies')}>
                Details →
              </button>
            </div>
            <div className="drow">
              <StatusDot status="live" />
              <span className="small strong">Basis monitor</span>
              <span className="v muted small">
                {state.proposals.length} proposing · {state.scanner.watching} watching
              </span>
            </div>
            <div className="drow">
              <StatusDot status="none" />
              <span className="small strong">Volume spike</span>
              <span className="v muted small">in development</span>
            </div>
          </div>

          {state.proposals.length > 0 && (
            <div className="rail-sec">
              <div className="rail-head">
                <span className="rail-title">Opportunities</span>
                <button className="sec-link" onClick={() => setPage('opportunities')}>
                  All →
                </button>
              </div>
              {state.proposals.slice(0, 4).map((p) => (
                <button key={p.id} className="lb-row" onClick={() => setPage('opportunities')}>
                  <span
                    className={`lb-bar ${p.basisNow >= 0 ? 'bid' : 'ask'}`}
                    style={{ width: `${Math.min(Math.abs(p.basisNow) * 12, 100)}%` }}
                  />
                  <TokenIcon symbol={p.symbol} size={24} />
                  <span>
                    <span className="lb-name">{baseOf(p.symbol)}</span>
                    <span className="lb-sub"> {p.side === 'SHORT_PERP_LONG_SPOT' ? 'short perp' : 'long perp'}</span>
                  </span>
                  <span className={`lb-val num ${signClass(p.basisNow)}`}>{fmtPct(p.basisNow, 2)}</span>
                </button>
              ))}
            </div>
          )}

          {acct && acct.entries.length > 0 && (
            <div className="rail-sec">
              <div className="rail-head">
                <span className="rail-title">Holdings</span>
                <button className="sec-link" onClick={() => setPage('account')}>
                  Account →
                </button>
              </div>
              {acct.entries.slice(0, 6).map((b) => (
                <button key={b.asset} className="lb-row" onClick={() => openDetail(`${b.asset}USDT`)}>
                  <TokenIcon symbol={`${b.asset}USDT`} size={24} />
                  <span>
                    <span className="lb-name">{b.asset}</span>
                    <span className="lb-sub"> {fmtQty(b.free + b.locked)}</span>
                  </span>
                  <span className="lb-val num">{fmtPrice(b.valueUsdt)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="rail-sec">
            <div className="rail-head">
              <span className="rail-title">System</span>
            </div>
            {Object.entries(state.feeds).map(([name, status]) => (
              <div key={name} className="drow">
                <StatusDot status={status} />
                <span className="small">{name}</span>
                <span className="v muted small">{status}</span>
              </div>
            ))}
            <div className="drow">
              <StatusDot status={state.binance.keysPresent ? (state.binance.connected ? 'live' : 'closed') : 'none'} />
              <span className="small">binance account</span>
              <span className="v muted small">
                {state.binance.keysPresent ? (state.binance.connected ? 'synced' : 'error') : 'no keys'}
              </span>
            </div>
            <div className="drow">
              <StatusDot status={state.binance.userStream === 'open' ? 'live' : 'none'} />
              <span className="small">user stream</span>
              <span className="v muted small">{state.binance.userStream}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
