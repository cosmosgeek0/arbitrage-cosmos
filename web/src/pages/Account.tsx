import { useStore } from '../store';
import { EmptyState, SetupChecklist, WarnStrip, Group, GRow, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { IconKey, IconWallet, IconWifi, IconPulse, IconPower } from '../components/Icons';
import { fmtPrice, fmtQty, timeAgo } from '../format';

export function Account() {
  const { state, openDetail } = useStore();
  if (!state) return <div className="container page page-narrow"><div className="empty-state">Connecting…</div></div>;
  const acct = state.account;
  const b = state.binance;

  return (
    <div className="container page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <div className="page-sub">Connection, key permissions and balances</div>
        </div>
      </div>

      {b.canWithdraw === true && (
        <WarnStrip>Recreate this key with withdrawals disabled — the key itself should not have that power.</WarnStrip>
      )}

      <Group title="Connection">
        <GRow
          icon={<IconKey />}
          color={b.keysPresent ? '#0a9b64' : '#697079'}
          label="API keys"
          sub="Server environment only — never in the browser"
          control={<StatePill tone={b.keysPresent ? 'ok' : 'idle'}>{b.keysPresent ? 'present' : 'absent'}</StatePill>}
        />
        <GRow
          icon={<IconWallet />}
          color="#e0a02a"
          label="Account sync"
          sub={b.lastSyncTs ? `last ${timeAgo(b.lastSyncTs)} · 30s polling` : '30s polling cadence'}
          control={
            <StatePill tone={b.connected ? 'ok' : b.keysPresent ? 'bad' : 'idle'}>
              {b.connected ? 'synced' : b.keysPresent ? 'failing' : 'waiting'}
            </StatePill>
          }
        />
        <GRow
          icon={<IconWifi />}
          color="#8257e0"
          label="User data stream"
          sub="Falls back to polling if unavailable"
          control={<StatePill tone={b.userStream === 'open' ? 'ok' : 'idle'}>{b.userStream}</StatePill>}
        />
      </Group>

      <Group title="Key permissions (detected from Binance)">
        <GRow
          icon={<IconPulse />}
          color={b.canTrade ? '#0a9b64' : '#697079'}
          label="Spot trading"
          sub="Enable only when you intend to send live orders"
          control={
            <StatePill tone={b.canTrade === true ? 'ok' : b.canTrade === false ? 'idle' : 'idle'}>
              {b.canTrade === null ? 'unknown' : b.canTrade ? 'enabled' : 'disabled'}
            </StatePill>
          }
        />
        <GRow
          icon={<IconPower />}
          color={b.canWithdraw === true ? '#e0414b' : '#0a9b64'}
          label="Withdrawals"
          sub="This app contains no withdrawal code — the key should not either"
          control={
            <StatePill tone={b.canWithdraw === true ? 'bad' : b.canWithdraw === false ? 'ok' : 'idle'}>
              {b.canWithdraw === null ? 'unknown' : b.canWithdraw ? 'ENABLED' : 'disabled'}
            </StatePill>
          }
        />
      </Group>

      {!b.keysPresent ? (
        <>
          <div className="settings-sec">Set up read access</div>
          <div className="card">
            <SetupChecklist />
            <div className="muted small" style={{ marginTop: 6 }}>
              Keys are read from server environment variables only. There is deliberately no key input in this UI —
              the browser must never see them.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="settings-sec">Balances · total {fmtPrice(acct?.totalUsdt)}</div>
          <div className="card pad-0">
            {!acct || acct.entries.length === 0 ? (
              <div className="card-body-empty">
                <EmptyState title="No balances">Deposit on Binance and it appears here within 30s.</EmptyState>
              </div>
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
                    {acct.entries.map((e) => (
                      <tr key={e.asset} className="rowlink" onClick={() => openDetail(`${e.asset}USDT`)}>
                        <td className="l">
                          <span className="tok">
                            <TokenIcon symbol={`${e.asset}USDT`} size={30} />
                            <span className="tok-name">{e.asset}</span>
                          </span>
                        </td>
                        <td><span className="num">{fmtQty(e.free)}</span></td>
                        <td className="muted"><span className="num">{e.locked ? fmtQty(e.locked) : '—'}</span></td>
                        <td className="muted"><span className="num">{e.priceUsdt !== null ? fmtPrice(e.priceUsdt) : '—'}</span></td>
                        <td className="val-strong"><span className="num">{fmtPrice(e.valueUsdt)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
