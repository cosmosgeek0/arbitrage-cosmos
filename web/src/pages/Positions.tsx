import { useStore } from '../store';
import { EmptyState } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPrice, fmtQty, signClass } from '../format';

export function Positions() {
  const { state, openTicket, openDetail } = useStore();

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Positions</h1>
          <div className="page-sub">Non-USDT holdings · average cost comes from ledgered fills</div>
        </div>
      </div>

      {(state?.positions.length ?? 0) === 0 ? (
        <EmptyState title="No positions">
          {state?.binance.keysPresent
            ? 'Anything you hold besides USDT shows here with value, average cost and unrealized PnL (once fills are in the ledger).'
            : 'Connect Binance keys to see holdings as positions.'}
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="mkt">
            <thead>
              <tr>
                <th className="l">Asset</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Value</th>
                <th>Avg cost</th>
                <th>Unrealized</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state!.positions.map((p) => (
                <tr key={p.asset} className="rowlink" onClick={() => openDetail(`${p.asset}USDT`)}>
                  <td className="l">
                    <span className="tok">
                      <TokenIcon symbol={`${p.asset}USDT`} size={30} />
                      <span className="tok-name">{p.asset}</span>
                    </span>
                  </td>
                  <td>
                    <span className="num">{fmtQty(p.free + p.locked)}</span>
                  </td>
                  <td>
                    <span className="num">{fmtPrice(p.priceUsdt)}</span>
                  </td>
                  <td className="val-strong">
                    <span className="num">{fmtPrice(p.valueUsdt)}</span>
                  </td>
                  <td className="muted">
                    <span className="num">{p.avgCost !== null ? fmtPrice(p.avgCost) : '— no fill history'}</span>
                  </td>
                  <td className={p.unrealizedUsd !== null ? signClass(p.unrealizedUsd) : ''}>
                    <span className="num">{p.unrealizedUsd !== null ? fmtPrice(p.unrealizedUsd) : '—'}</span>
                  </td>
                  <td>
                    <button
                      className="mini-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket({ symbol: `${p.asset}USDT`, side: 'SELL', source: 'manual' });
                      }}
                    >
                      Sell…
                    </button>
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
