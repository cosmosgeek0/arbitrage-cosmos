import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { TokenIcon } from '../components/TokenIcon';
import { EmptyState, SetupChecklist, StatusDot } from '../components/ui';
import { fmtPrice, fmtQty, fmtPct, signClass, timeAgo } from '../format';
import type { LoansSnapshot } from '../types';

type Tab = 'spot' | 'margin' | 'futures' | 'earn';

export function Wallets() {
  const { state, markets, openDetail, openTicket } = useStore();
  const [tab, setTab] = useState<Tab>('spot');
  const [loans, setLoans] = useState<LoansSnapshot | null>(null);

  useEffect(() => {
    if (tab !== 'margin') return;
    void fetch('/api/loans')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLoans(d as LoansSnapshot))
      .catch(() => undefined);
  }, [tab]);

  const acct = state?.account;
  const keysPresent = state?.binance.keysPresent ?? false;
  const changeOf = (asset: string) => markets.find((m) => m.symbol === `${asset}USDT`)?.change24hPct ?? null;
  const margin = loans?.margin;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Wallets &amp; Assets</h1>
          <div className="page-sub">
            Balances by wallet · {keysPresent ? `synced ${timeAgo(state?.binance.lastSyncTs ?? null)}` : 'not connected'}
          </div>
        </div>
        <div className="head-actions">
          <span className="sec-note num">total {acct ? fmtPrice(acct.totalUsdt) : '—'}</span>
        </div>
      </div>

      <div className="atabs">
        {(['spot', 'margin', 'futures', 'earn'] as Tab[]).map((t) => (
          <button key={t} className={`atab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'spot' ? 'Spot' : t === 'margin' ? 'Cross Margin' : t === 'futures' ? 'Futures' : 'Earn'}
          </button>
        ))}
      </div>

      {tab === 'spot' &&
        (!keysPresent ? (
          <div className="ghost-tile">
            <div>
              <div className="gt-title">Spot wallet needs API keys</div>
              <div className="gt-sub">Read-only keys on the server unlock balances here.</div>
              <SetupChecklist />
            </div>
            <span className="gt-badge">setup</span>
          </div>
        ) : !acct || acct.entries.length === 0 ? (
          <EmptyState title="Spot wallet is empty">Deposit on Binance and it appears here within 30s.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mkt">
              <thead>
                <tr>
                  <th className="l">Asset</th>
                  <th>Free</th>
                  <th>Locked</th>
                  <th>Price</th>
                  <th>24h</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {acct.entries.map((b) => (
                  <tr key={b.asset} className="rowlink" onClick={() => b.asset !== 'USDT' && openDetail(`${b.asset}USDT`)}>
                    <td className="l">
                      <span className="tok">
                        <TokenIcon symbol={`${b.asset}USDT`} size={30} />
                        <span className="tok-meta">
                          <span className="tok-name">{b.asset}</span>
                          <span className="tok-sub">spot</span>
                        </span>
                      </span>
                    </td>
                    <td><span className="num">{fmtQty(b.free)}</span></td>
                    <td className="muted"><span className="num">{b.locked ? fmtQty(b.locked) : '—'}</span></td>
                    <td className="muted"><span className="num">{b.priceUsdt !== null ? fmtPrice(b.priceUsdt) : '—'}</span></td>
                    <td className={signClass(changeOf(b.asset))}><span className="num">{fmtPct(changeOf(b.asset))}</span></td>
                    <td className="val-strong"><span className="num">{fmtPrice(b.valueUsdt)}</span></td>
                    <td>
                      {b.asset !== 'USDT' && (
                        <button
                          className="mini-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTicket({ symbol: `${b.asset}USDT`, side: 'SELL', source: 'manual' });
                          }}
                        >
                          Sell…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'margin' &&
        (!margin || !margin.available ? (
          <div className="ghost-tile">
            <StatusDot status="none" />
            <div>
              <div className="gt-title">Cross margin not available</div>
              <div className="gt-sub">
                {margin?.error ??
                  'Needs API keys (and margin permission on the key). Once connected: assets, borrowed amounts, interest and net position appear here.'}
              </div>
            </div>
            <span className="gt-badge">{keysPresent ? 'permission' : 'setup'}</span>
          </div>
        ) : (
          <>
            <div className="metric-strip">
              <div className="metric">
                <span className="k">Margin level</span>
                <span className={`v num ${margin.marginLevel !== null && margin.marginLevel < 1.5 ? 'down' : ''}`}>
                  {margin.marginLevel?.toFixed(2) ?? '—'}
                </span>
                <span className="s">&lt;1.3 margin call · &lt;1.1 liquidation</span>
              </div>
              <div className="metric">
                <span className="k">Net asset (BTC)</span>
                <span className="v num">{margin.totalNetAssetBtc.toFixed(8)}</span>
              </div>
              <div className="metric">
                <span className="k">Liability (BTC)</span>
                <span className="v num">{margin.totalLiabilityBtc.toFixed(8)}</span>
              </div>
              <div className="metric">
                <span className="k">Borrow enabled</span>
                <span className={`v ${margin.borrowEnabled ? 'up' : 'down'}`}>{margin.borrowEnabled ? 'yes' : 'no'}</span>
              </div>
            </div>
            {margin.assets.length === 0 ? (
              <EmptyState title="No margin balances" />
            ) : (
              <div className="table-scroll">
                <table className="mkt dense">
                  <thead>
                    <tr>
                      <th className="l">Asset</th>
                      <th>Free</th>
                      <th>Locked</th>
                      <th>Borrowed</th>
                      <th>Interest</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {margin.assets.map((a) => (
                      <tr key={a.asset}>
                        <td className="l">
                          <span className="tok">
                            <TokenIcon symbol={`${a.asset}USDT`} size={26} />
                            <span className="tok-name">{a.asset}</span>
                          </span>
                        </td>
                        <td><span className="num">{fmtQty(a.free)}</span></td>
                        <td className="muted"><span className="num">{a.locked ? fmtQty(a.locked) : '—'}</span></td>
                        <td className={a.borrowed > 0 ? 'down' : 'muted'}><span className="num">{a.borrowed ? fmtQty(a.borrowed) : '—'}</span></td>
                        <td className={a.interest > 0 ? 'down' : 'muted'}><span className="num">{a.interest ? fmtQty(a.interest) : '—'}</span></td>
                        <td className="val-strong"><span className="num">{fmtQty(a.netAsset)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}

      {tab === 'futures' && (
        <div className="ghost-tile">
          <StatusDot status="none" />
          <div>
            <div className="gt-title">Futures wallet not configured</div>
            <div className="gt-sub">
              The perp leg of basis trades will live here. Futures account endpoints get wired when the two-leg
              executor ships (testnet first) — this page will then show USDⓈ-M balance, positions and margin.
            </div>
          </div>
          <span className="gt-badge">planned</span>
        </div>
      )}

      {tab === 'earn' && (
        <div className="ghost-tile">
          <StatusDot status="none" />
          <div>
            <div className="gt-title">Earn not integrated</div>
            <div className="gt-sub">
              Flexible earn balances are out of scope for the trading loop. If idle USDT should earn while waiting,
              this is where it will show — deliberately later.
            </div>
          </div>
          <span className="gt-badge">later</span>
        </div>
      )}
    </div>
  );
}
