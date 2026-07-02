import { useStore } from '../store';
import { AssetDot } from '../components/AssetDot';
import { EmptyState, SetupChecklist, WarnBanner } from '../components/ui';
import { fmtPrice, timeAgo } from '../format';

export function Account() {
  const { state } = useStore();
  if (!state) return <div className="page-loading">Connecting…</div>;
  const acct = state.account;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <b>Connection</b>
        </div>
        <div className="conn-grid">
          <div className="conn-item">
            <span className={`dot ${state.binance.keysPresent ? 'dot-open' : 'dot-idle'}`} />
            API keys {state.binance.keysPresent ? 'present (server env)' : 'absent'}
          </div>
          <div className="conn-item">
            <span className={`dot ${state.binance.connected ? 'dot-open' : 'dot-closed'}`} />
            Account sync{' '}
            {state.binance.connected
              ? `ok · ${state.binance.lastSyncTs ? timeAgo(state.binance.lastSyncTs) : ''}`
              : state.binance.keysPresent
                ? `failing: ${state.binance.lastError ?? 'unknown'}`
                : 'waiting for keys'}
          </div>
          <div className="conn-item">
            <span className={`dot ${state.binance.userStream === 'open' ? 'dot-open' : 'dot-idle'}`} />
            User data stream: {state.binance.userStream}
            {state.binance.userStream !== 'open' && state.binance.keysPresent && ' — falling back to 30s polling'}
          </div>
          <div className="conn-item">
            <span className={`dot ${state.binance.canWithdraw === false ? 'dot-open' : state.binance.canWithdraw === true ? 'dot-closed' : 'dot-idle'}`} />
            Withdrawal permission:{' '}
            {state.binance.canWithdraw === null ? 'unknown' : state.binance.canWithdraw ? 'ENABLED (fix this!)' : 'disabled ✓'}
          </div>
        </div>
        {state.binance.canWithdraw === true && (
          <WarnBanner>Recreate this key with withdrawals disabled. This app contains no withdrawal code, but the key itself should not have that power.</WarnBanner>
        )}
      </div>

      {!state.binance.keysPresent ? (
        <div className="card connect-card">
          <div className="connect-head">
            <b>Set up read access</b>
          </div>
          <SetupChecklist />
          <div className="muted small">
            Keys are read from server environment variables only. There is no key input in this UI on purpose — the
            browser must never see them.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <b>Balances</b>
            <span className="muted small">total {fmtPrice(acct?.totalUsdt)}</span>
          </div>
          {!acct || acct.entries.length === 0 ? (
            <EmptyState title="No balances">Deposit something on Binance and it appears here within 30s.</EmptyState>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Free</th>
                  <th>Locked</th>
                  <th>Price</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {acct.entries.map((b) => (
                  <tr key={b.asset}>
                    <td>
                      <div className="asset-cell">
                        <AssetDot base={b.asset} size={28} />
                        <span className="strong">{b.asset}</span>
                      </div>
                    </td>
                    <td className="num">{b.free}</td>
                    <td className="num muted">{b.locked || '—'}</td>
                    <td className="num muted">{b.priceUsdt !== null ? fmtPrice(b.priceUsdt) : 'no USDT market'}</td>
                    <td className="num strong">{fmtPrice(b.valueUsdt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
