import { useMemo } from 'react';
import { useStore } from '../store';
import { Empty, Pill } from '../components/px';
import { TokenIcon } from '../components/TokenIcon';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, signClass } from '../format';

function positionCostBasis(value: number | null, qty: number): number | null {
  if (value === null || qty <= 0) return null;
  return value * qty;
}

function positionPnlPct(avgCost: number | null, price: number | null, qty: number, unrealizedUsd: number | null): number | null {
  const basis = positionCostBasis(avgCost, qty);
  if (basis === null || basis <= 0 || price === null || unrealizedUsd === null) return null;
  return (unrealizedUsd / basis) * 100;
}

export function Positions() {
  const { state, openDetail } = useStore();
  const positions = state?.positions ?? [];
  const keysPresent = !!state?.binance.keysPresent;

  const totals = useMemo(() => {
    const value = positions.reduce((s, p) => s + p.valueUsdt, 0);
    const lockedValue = positions.reduce((s, p) => s + (p.priceUsdt ?? 0) * p.locked, 0);
    const freeValue = Math.max(0, value - lockedValue);
    const knownPnl = positions.filter((p) => p.unrealizedUsd !== null);
    const unrealized = knownPnl.length ? knownPnl.reduce((s, p) => s + (p.unrealizedUsd ?? 0), 0) : null;
    const largest = positions.length ? [...positions].sort((a, b) => b.valueUsdt - a.valueUsdt)[0] : null;
    const coverage = positions.length ? knownPnl.length / positions.length : 0;
    return { value, lockedValue, freeValue, unrealized, largest, coverage, knownPnl: knownPnl.length };
  }, [positions]);

  return (
    <>
      <div className="hp-stats exec-stats">
        <div className="hp-stat">
          <span className="k">Spot exposure</span>
          <span className="v">{fmtMoney(totals.value)}</span>
          <span className="s">{fmtMoney(totals.freeValue)} free · {fmtMoney(totals.lockedValue)} locked</span>
        </div>
        <div className="hp-stat">
          <span className="k">Unrealized PnL</span>
          <span className={`v ${totals.unrealized === null ? '' : signClass(totals.unrealized)}`}>
            {totals.unrealized === null ? '—' : fmtPrice(totals.unrealized)}
          </span>
          <span className="s">
            {totals.unrealized === null ? 'needs ledgered fills for cost basis' : `${fmtPct(totals.coverage * 100, 0, false)} cost coverage`}
          </span>
        </div>
        <div className="hp-stat">
          <span className="k">Largest position</span>
          <span className="v">{totals.largest ? totals.largest.asset : '—'}</span>
          <span className="s">{totals.largest ? fmtMoney(totals.largest.valueUsdt) : 'no active asset'}</span>
        </div>
      </div>

      <section className="hp-group lg-feed" aria-label="Positions">
        <div className="lg-feed-head">
          <h3>Spot positions</h3>
          <span className="hp-val">
            {positions.length} holdings · {totals.knownPnl}/{positions.length || 0} with fill-cost basis
          </span>
        </div>
        {positions.length === 0 ? (
          <div className="lg-empty-pad">
            <Empty title="No positions loaded">
              {keysPresent
                ? 'Account sync is available, but no non-USDT holdings are currently reported.'
                : 'Add server-side read keys to load balances. Nothing here pretends data exists.'}
            </Empty>
          </div>
        ) : (
          <div className="hp-table-wrap">
            <table className="hp-table exec-table">
              <colgroup>
                <col style={{ width: 130 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num-r">Quantity</th>
                  <th className="num-r">Free / locked</th>
                  <th className="num-r">Mark</th>
                  <th className="num-r">Value</th>
                  <th className="num-r">Avg cost</th>
                  <th className="num-r">Unrealized</th>
                  <th className="num-r">ROE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...positions].sort((a, b) => b.valueUsdt - a.valueUsdt).map((p) => {
                  const qty = p.free + p.locked;
                  const pnlPct = positionPnlPct(p.avgCost, p.priceUsdt, qty, p.unrealizedUsd);
                  return (
                    <tr key={p.asset} onClick={() => openDetail(`${p.asset}USDT`)}>
                      <td className="t-source">
                        <span className="exec-sym">
                          <TokenIcon symbol={`${p.asset}USDT`} size={16} />
                          {p.asset}
                        </span>
                      </td>
                      <td className="t-value num-r">{fmtQty(qty)}</td>
                      <td className="t-value num-r">{fmtQty(p.free)} / {fmtQty(p.locked)}</td>
                      <td className="t-value num-r">{fmtPrice(p.priceUsdt)}</td>
                      <td className="t-value num-r">{fmtPrice(p.valueUsdt)}</td>
                      <td className={`t-value num-r${p.avgCost === null ? ' t-layer' : ''}`}>
                        {p.avgCost !== null ? fmtPrice(p.avgCost) : 'no fills'}
                      </td>
                      <td className={`t-value num-r ${p.unrealizedUsd !== null ? signClass(p.unrealizedUsd) : 't-layer'}`}>
                        {p.unrealizedUsd !== null ? fmtPrice(p.unrealizedUsd) : '—'}
                      </td>
                      <td className={`t-value num-r ${pnlPct !== null ? signClass(pnlPct) : 't-layer'}`}>
                        {pnlPct !== null ? fmtPct(pnlPct) : '—'}
                      </td>
                      <td>
                        <span className="exec-row-actions">
                          <button
                            className="hp-btn exec-cancel"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(`${p.asset}USDT`);
                            }}
                          >
                            Market
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {positions.length > 0 && totals.knownPnl < positions.length && (
        <p className="hp-foot" style={{ marginTop: 12 }}>
          <Pill tone="idle">note</Pill> Average cost is reconstructed from ledgered fills — assets without imported fills show no PnL instead of fake numbers. Futures/liquidation fields wait for a verified futures path.
        </p>
      )}
    </>
  );
}
