import { useState } from 'react';
import { useStore } from '../store';
import { StatCard, EmptyState, SetupChecklist, SideTag, KindChip, WarnBanner } from '../components/ui';
import { AssetDot } from '../components/AssetDot';
import { fmtPrice, fmtPct, timeAgo, fmtTime } from '../format';

export function Dashboard() {
  const { state, setPage, openTicket } = useStore();
  const [quickSymbol, setQuickSymbol] = useState('BTCUSDT');
  const [quickSide, setQuickSide] = useState<'BUY' | 'SELL'>('BUY');

  if (!state) return <div className="page-loading">Connecting to engine…</div>;

  const acct = state.account;
  const exposure = state.positions.reduce((s, p) => s + p.valueUsdt, 0);
  const errorsToday = state.events.filter(
    (e) => e.kind === 'error_event' && Date.now() - e.ts < 24 * 3600 * 1000
  );

  return (
    <>
      {!state.binance.keysPresent && (
        <div className="card connect-card">
          <div className="connect-head">
            <span className="dot dot-closed" />
            <b>Binance not connected</b>
            <span className="muted">— public market data is streaming; account features are waiting for keys</span>
          </div>
          <SetupChecklist />
        </div>
      )}
      {state.binance.keysPresent && !state.binance.connected && (
        <WarnBanner>
          Binance keys are present but the last account sync failed: {state.binance.lastError ?? 'unknown error'}
        </WarnBanner>
      )}
      {state.binance.canWithdraw === true && (
        <WarnBanner>
          This API key can WITHDRAW. The app never withdraws, but the key should not have that power — recreate it
          with withdrawals disabled.
        </WarnBanner>
      )}

      <div className="stat-grid">
        <StatCard
          label="Total equity"
          value={acct ? fmtPrice(acct.totalUsdt) : '—'}
          sub={
            acct && acct.dayChangeUsd !== null ? (
              <span className={acct.dayChangeUsd >= 0 ? 'pos' : 'neg'}>
                {acct.dayChangeUsd >= 0 ? '+' : ''}
                {acct.dayChangeUsd.toFixed(2)} today
              </span>
            ) : (
              'since day open'
            )
          }
        />
        <StatCard label="Available USDT" value={acct ? fmtPrice(acct.availableUsdt) : '—'} sub="free, not in orders" />
        <StatCard
          label="Realized PnL today"
          value={acct ? fmtPrice(acct.realizedTodayUsd) : '—'}
          accent={acct ? (acct.realizedTodayUsd > 0 ? 'green' : acct.realizedTodayUsd < 0 ? 'red' : undefined) : undefined}
          sub="from ledgered fills"
        />
        <StatCard
          label="Open exposure"
          value={acct ? fmtPrice(exposure) : '—'}
          sub={`${state.openOrders.length} open order${state.openOrders.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="dash-grid">
        <div className="dash-main">
          <div className="card">
            <div className="card-head">
              <b>Open orders</b>
              <button className="link-btn" onClick={() => setPage('orders')}>
                View all →
              </button>
            </div>
            {state.openOrders.length === 0 ? (
              <EmptyState title="No open orders">
                {state.binance.keysPresent ? 'Orders you place will appear here live.' : 'Connect Binance to see your orders.'}
              </EmptyState>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Type</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {state.openOrders.slice(0, 5).map((o) => (
                    <tr key={o.orderId}>
                      <td className="strong">{o.symbol}</td>
                      <td>
                        <SideTag side={o.side} />
                      </td>
                      <td className="muted">{o.type}</td>
                      <td className="num">{fmtPrice(o.price)}</td>
                      <td className="num">{o.origQty}</td>
                      <td className="muted small">
                        {timeAgo(o.time)} {o.stale && <span className="stale-flag">stale</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <b>Recent fills</b>
              <button className="link-btn" onClick={() => setPage('fills')}>
                View all →
              </button>
            </div>
            {state.recentFills.length === 0 ? (
              <EmptyState title="No fills recorded yet">
                Fills are captured live from the moment Binance is connected. Older history can be imported per
                symbol on the Fills page.
              </EmptyState>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Value</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {state.recentFills.slice(0, 5).map((f) => (
                    <tr key={`${f.symbol}-${f.tradeId}`}>
                      <td className="strong">{f.symbol}</td>
                      <td>
                        <SideTag side={f.side} />
                      </td>
                      <td className="num">{fmtPrice(f.price)}</td>
                      <td className="num">{f.qty}</td>
                      <td className="num">{fmtPrice(f.quoteQty)}</td>
                      <td className="muted small">{timeAgo(f.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <b>Event timeline</b>
              <button className="link-btn" onClick={() => setPage('ledger')}>
                Full ledger →
              </button>
            </div>
            <div className="timeline">
              {state.events.slice(0, 12).map((ev) => (
                <div key={ev.id} className="timeline-row">
                  <span className="timeline-time mono">{fmtTime(ev.ts)}</span>
                  <KindChip kind={ev.kind} />
                  <span className="timeline-sym">{ev.symbol ?? ''}</span>
                  <span className="timeline-data muted">
                    {ev.data != null ? JSON.stringify(ev.data).slice(0, 80) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-side">
          <div className="card ticket-card">
            <div className="card-head">
              <b>Manual trade</b>
            </div>
            <label className="fld">
              <span>Symbol</span>
              <input
                value={quickSymbol}
                onChange={(e) => setQuickSymbol(e.target.value.toUpperCase())}
                spellCheck={false}
              />
            </label>
            <div className="side-toggle">
              <button className={`side-btn buy ${quickSide === 'BUY' ? 'active' : ''}`} onClick={() => setQuickSide('BUY')}>
                BUY
              </button>
              <button
                className={`side-btn sell ${quickSide === 'SELL' ? 'active' : ''}`}
                onClick={() => setQuickSide('SELL')}
              >
                SELL
              </button>
            </div>
            <button
              className="btn btn-dark wide"
              onClick={() => openTicket({ symbol: quickSymbol, side: quickSide, source: 'manual' })}
            >
              Open trade ticket
            </button>
            <div className="muted small center-note">
              Every send passes the risk gate and a typed confirmation. Mode: <b>{state.mode}</b>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <b>Strategy state</b>
              <button className="link-btn" onClick={() => setPage('strategies')}>
                Details →
              </button>
            </div>
            <div className="strat-row">
              <span className="dot dot-open" />
              <div>
                <div className="strong">Basis monitor</div>
                <div className="muted small">
                  {state.scanner.pairs} pairs · {state.proposals.length} proposal
                  {state.proposals.length === 1 ? '' : 's'} · {state.scanner.watching} watching
                </div>
              </div>
            </div>
            <div className="strat-row">
              <span className="dot dot-idle" />
              <div>
                <div className="strong">Volume spike monitor</div>
                <div className="muted small">in development — not running</div>
              </div>
            </div>
            {state.proposals.length > 0 && (
              <button className="btn btn-gold wide" onClick={() => setPage('opportunities')}>
                Review {state.proposals.length} proposal{state.proposals.length === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <b>System</b>
            </div>
            {Object.entries(state.feeds).map(([name, status]) => (
              <div key={name} className="feed-status-row">
                <span className={`dot dot-${status}`} />
                <span className="feed-name small">{name}</span>
                <span className="muted small">{status}</span>
              </div>
            ))}
            <div className="feed-status-row">
              <span
                className={`dot ${state.binance.keysPresent ? (state.binance.connected ? 'dot-open' : 'dot-closed') : 'dot-idle'}`}
              />
              <span className="feed-name small">binance account</span>
              <span className="muted small">
                {state.binance.keysPresent
                  ? state.binance.connected
                    ? `synced ${state.binance.lastSyncTs ? timeAgo(state.binance.lastSyncTs) : ''}`
                    : 'error'
                  : 'no keys'}
              </span>
            </div>
            <div className="feed-status-row">
              <span className={`dot ${state.binance.userStream === 'open' ? 'dot-open' : 'dot-idle'}`} />
              <span className="feed-name small">user stream</span>
              <span className="muted small">{state.binance.userStream}{state.binance.userStream !== 'open' && state.binance.keysPresent ? ' (30s polling)' : ''}</span>
            </div>
            {errorsToday.length > 0 && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ⚠ {errorsToday.length} error event{errorsToday.length === 1 ? '' : 's'} in 24h — see ledger
              </div>
            )}
          </div>

          {acct && acct.entries.length > 0 && (
            <div className="card">
              <div className="card-head">
                <b>Holdings</b>
                <button className="link-btn" onClick={() => setPage('account')}>
                  Account →
                </button>
              </div>
              {acct.entries.slice(0, 5).map((b) => (
                <div key={b.asset} className="holding-row">
                  <AssetDot base={b.asset} size={26} />
                  <span className="strong">{b.asset}</span>
                  <span className="muted small">{(b.free + b.locked).toFixed(6)}</span>
                  <span className="num">{fmtPrice(b.valueUsdt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
