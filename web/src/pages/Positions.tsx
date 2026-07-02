import { useStore } from '../store';
import { AssetDot } from '../components/AssetDot';
import { EmptyState } from '../components/ui';
import { fmtPrice } from '../format';

export function Positions() {
  const { state, openTicket } = useStore();
  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <div className="card table-card">
      <div className="card-head">
        <b>Spot positions</b>
        <span className="muted small">non-USDT holdings · avg cost comes from ledgered fills</span>
      </div>
      {state.positions.length === 0 ? (
        <EmptyState title="No positions">
          {state.binance.keysPresent
            ? 'Anything you hold besides USDT shows here with value, average cost and unrealized PnL (once fills are in the ledger).'
            : 'Connect Binance keys to see your holdings as positions.'}
        </EmptyState>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Value</th>
              <th>Avg cost</th>
              <th>Unrealized</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.positions.map((p) => (
              <tr key={p.asset}>
                <td>
                  <div className="asset-cell">
                    <AssetDot base={p.asset} size={28} />
                    <span className="strong">{p.asset}</span>
                  </div>
                </td>
                <td className="num">{(p.free + p.locked).toFixed(8)}</td>
                <td className="num">{fmtPrice(p.priceUsdt)}</td>
                <td className="num strong">{fmtPrice(p.valueUsdt)}</td>
                <td className="num muted">{p.avgCost !== null ? fmtPrice(p.avgCost) : '— no fill history'}</td>
                <td className={`num ${p.unrealizedUsd === null ? 'muted' : p.unrealizedUsd >= 0 ? 'pos' : 'neg'}`}>
                  {p.unrealizedUsd !== null ? fmtPrice(p.unrealizedUsd) : '—'}
                </td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openTicket({ symbol: `${p.asset}USDT`, side: 'SELL', source: 'manual' })}
                  >
                    Sell…
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
