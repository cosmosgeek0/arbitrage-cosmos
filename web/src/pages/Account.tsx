import { useStore } from '../store';
import { EmptyState, SetupChecklist, WarnStrip, StatusDot } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPrice, fmtQty, timeAgo } from '../format';

export function Account() {
  const { state, openDetail } = useStore();
  if (!state) return <div className="container page"><div className="empty-state">Connecting…</div></div>;
  const acct = state.account;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <div className="page-sub">Connection, permissions and balances</div>
        </div>
      </div>

      <div className="metric-strip">
        <div className="metric">
          <span className="k">API keys</span>
          <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={state.binance.keysPresent ? 'live' : 'none'} />
            {state.binance.keysPresent ? 'present' : 'absent'}
          </span>
          <span className="s">server env only</span>
        </div>
        <div className="metric">
          <span className="k">Account sync</span>
          <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={state.binance.connected ? 'live' : state.binance.keysPresent ? 'closed' : 'none'} />
            {state.binance.connected ? 'ok' : state.binance.keysPresent ? 'failing' : 'waiting'}
          </span>
          <span className="s">{state.binance.lastSyncTs ? timeAgo(state.binance.lastSyncTs) : '30s polling'}</span>
        </div>
        <div className="metric">
          <span className="k">User stream</span>
          <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={state.binance.userStream} />
            {state.binance.userStream}
          </span>
          <span className="s">falls back to polling</span>
        </div>
        <div className="metric">
          <span className="k">Spot trading</span>
          <span className={`v ${state.binance.canTrade === true ? 'up' : state.binance.canTrade === false ? 'down' : ''}`}>
            {state.binance.canTrade === null ? 'unknown' : state.binance.canTrade ? 'enabled' : 'disabled'}
          </span>
          <span className="s">key permission detected from Binance</span>
        </div>
        <div className="metric">
          <span className="k">Withdrawals</span>
          <span className={`v ${state.binance.canWithdraw === true ? 'down' : state.binance.canWithdraw === false ? 'up' : ''}`}>
            {state.binance.canWithdraw === null ? 'unknown' : state.binance.canWithdraw ? 'ENABLED' : 'disabled ✓'}
          </span>
          <span className="s">this app has no withdrawal code</span>
        </div>
      </div>

      {state.binance.canWithdraw === true && (
        <WarnStrip>
          Recreate this key with withdrawals disabled — the key itself should not have that power.
        </WarnStrip>
      )}
      {state.binance.keysPresent && !state.binance.connected && (
        <WarnStrip>Last sync error: {state.binance.lastError ?? 'unknown'}</WarnStrip>
      )}

      {!state.binance.keysPresent ? (
        <div className="ghost-tile">
          <div>
            <div className="gt-title">Set up read access</div>
            <div className="gt-sub">
              Keys are read from server environment variables only. There is deliberately no key input in this UI —
              the browser must never see them.
            </div>
            <SetupChecklist />
          </div>
          <span className="gt-badge">setup</span>
        </div>
      ) : (
        <>
          <div className="sec-head">
            <h2 className="sec-title">Balances</h2>
            <span className="sec-note">total {fmtPrice(acct?.totalUsdt)}</span>
          </div>
          {!acct || acct.entries.length === 0 ? (
            <EmptyState title="No balances">Deposit on Binance and it appears here within 30s.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="mkt">
                <thead>
                  <tr>
                    <th className="l">Asset</th>
                    <th>Free</th>
                    <th>Locked</th>
                    <th>Price</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {acct.entries.map((b) => (
                    <tr key={b.asset} className="rowlink" onClick={() => openDetail(`${b.asset}USDT`)}>
                      <td className="l">
                        <span className="tok">
                          <TokenIcon symbol={`${b.asset}USDT`} size={30} />
                          <span className="tok-name">{b.asset}</span>
                        </span>
                      </td>
                      <td>
                        <span className="num">{fmtQty(b.free)}</span>
                      </td>
                      <td className="muted">
                        <span className="num">{b.locked ? fmtQty(b.locked) : '—'}</span>
                      </td>
                      <td className="muted">
                        <span className="num">{b.priceUsdt !== null ? fmtPrice(b.priceUsdt) : 'no USDT market'}</span>
                      </td>
                      <td className="val-strong">
                        <span className="num">{fmtPrice(b.valueUsdt)}</span>
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
