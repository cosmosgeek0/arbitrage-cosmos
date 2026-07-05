import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useStore } from '../store';
import { EmptyState, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconLayers,
  IconPulse,
  IconShield,
  IconTicket,
  IconWallet,
} from '../components/Icons';
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

function PositionMetric({
  label,
  value,
  sub,
  tone = 'idle',
  icon,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: 'ok' | 'bad' | 'warn' | 'idle';
  icon: ReactNode;
}) {
  return (
    <div className={`position-metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <em>{label}</em>
        <b className="num">{value}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

function ReadinessStep({
  n,
  label,
  detail,
  tone,
}: {
  n: string;
  label: string;
  detail: string;
  tone: 'ok' | 'warn' | 'idle';
}) {
  return (
    <div className={`positions-ready-step ${tone}`}>
      <i>{n}</i>
      <b>{label}</b>
      <span>{detail}</span>
    </div>
  );
}

export function Positions() {
  const { state, openTicket, openDetail, setPage } = useStore();
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

  const allocationRows = useMemo(() => {
    const total = Math.max(1e-9, totals.value);
    return [...positions]
      .sort((a, b) => b.valueUsdt - a.valueUsdt)
      .slice(0, 6)
      .map((p) => ({
        asset: p.asset,
        value: p.valueUsdt,
        pct: totals.value > 0 ? (p.valueUsdt / total) * 100 : 0,
      }));
  }, [positions, totals.value]);

  return (
    <div className="container page positions-page">
      <section className="positions-hero card">
        <div className="positions-hero-copy">
          <span className="positions-eyebrow"><IconLayers size={15} /> position monitor</span>
          <h1 className="page-title">Positions</h1>
          <p>
            Spot holdings are treated as positions only when the account is connected. Average cost is reconstructed
            from ledgered fills, so missing fill history stays visible instead of becoming fake PnL.
          </p>
          <div className="positions-hero-actions">
            <button className="cta-pill" type="button" onClick={() => setPage('trade')}>
              <IconTicket size={14} />
              Manual trade
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('fills')}>
              <IconBook size={14} />
              Fill ledger
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('risk')}>
              <IconShield size={14} />
              Risk gate
            </button>
          </div>
        </div>
        <div className="positions-hero-panel">
          <StatePill tone={keysPresent ? 'ok' : 'idle'}>{keysPresent ? 'account sync ready' : 'keys not set'}</StatePill>
          <span>Total spot exposure</span>
          <b className="num">{fmtMoney(totals.value)}</b>
          <em>{positions.length} assets · {totals.knownPnl}/{positions.length || 0} with fill-cost basis</em>
          <div className="positions-allocation">
            {allocationRows.length ? allocationRows.map((p) => (
              <button key={p.asset} type="button" onClick={() => openDetail(`${p.asset}USDT`)} title={`Open ${p.asset} market`}>
                <span>
                  <TokenIcon symbol={`${p.asset}USDT`} size={20} />
                  <b>{p.asset}</b>
                </span>
                <i><span style={{ width: `${Math.max(3, p.pct)}%` }} /></i>
                <em className="num">{fmtMoney(p.value)}</em>
              </button>
            )) : (
              <div className="positions-allocation-empty">
                <span />
                <b>No holdings loaded</b>
                <em>Server-side keys unlock balances and reconstructed positions.</em>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="position-metric-strip">
        <PositionMetric
          icon={<IconWallet size={16} />}
          label="Exposure"
          value={fmtMoney(totals.value)}
          sub={`${fmtMoney(totals.freeValue)} free · ${fmtMoney(totals.lockedValue)} locked`}
          tone={positions.length ? 'warn' : 'idle'}
        />
        <PositionMetric
          icon={<IconPulse size={16} />}
          label="Unrealized PnL"
          value={totals.unrealized === null ? '—' : fmtPrice(totals.unrealized)}
          sub={totals.unrealized === null ? 'needs ledgered fills' : `${fmtPct(totals.coverage * 100, 0, false)} cost coverage`}
          tone={totals.unrealized === null ? 'idle' : totals.unrealized >= 0 ? 'ok' : 'bad'}
        />
        <PositionMetric
          icon={<IconChart size={16} />}
          label="Largest position"
          value={totals.largest ? totals.largest.asset : '—'}
          sub={totals.largest ? fmtMoney(totals.largest.valueUsdt) : 'no active asset'}
          tone={totals.largest ? 'ok' : 'idle'}
        />
        <PositionMetric
          icon={<IconAlert size={16} />}
          label="Perp risk"
          value="not active"
          sub="liquidation fields wait for futures/testnet path"
          tone="idle"
        />
      </section>

      <div className="positions-layout">
        <main className="positions-main card">
          <div className="positions-table-head">
            <div>
              <h2>Spot position blotter</h2>
              <span>{positions.length} holdings from Binance balances · avg cost from fills</span>
            </div>
            <StatePill tone={positions.length ? 'ok' : keysPresent ? 'warn' : 'idle'}>
              {positions.length ? 'loaded' : keysPresent ? 'no holdings' : 'disconnected'}
            </StatePill>
          </div>

          {positions.length === 0 ? (
            <div className="positions-empty">
              <EmptyState title="No positions loaded">
                {keysPresent
                  ? 'The account sync is available, but no non-USDT holdings are currently reported as positions.'
                  : 'Add server-side read keys to load balances. This page is prepared for the connected account state without pretending data exists.'}
              </EmptyState>
              <div className="positions-empty-actions">
                <button className="cta-pill" type="button" onClick={() => setPage('wallets')}>Wallets & assets</button>
                <button className="mini-btn" type="button" onClick={() => setPage('trade')}>Open trade ticket</button>
                <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>Audit ledger</button>
              </div>
            </div>
          ) : (
            <div className="positions-table-wrap">
              <table className="positions-table">
                <thead>
                  <tr>
                    <th className="l">Asset</th>
                    <th>Quantity</th>
                    <th>Free / locked</th>
                    <th>Mark</th>
                    <th>Value</th>
                    <th>Avg cost</th>
                    <th>Unrealized</th>
                    <th>ROE</th>
                    <th className="l">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...positions].sort((a, b) => b.valueUsdt - a.valueUsdt).map((p) => {
                    const qty = p.free + p.locked;
                    const pnlPct = positionPnlPct(p.avgCost, p.priceUsdt, qty, p.unrealizedUsd);
                    return (
                      <tr key={p.asset} onClick={() => openDetail(`${p.asset}USDT`)}>
                        <td className="l">
                          <span className="positions-token">
                            <TokenIcon symbol={`${p.asset}USDT`} size={34} />
                            <span>
                              <b>{p.asset}</b>
                              <em>{p.asset}USDT spot</em>
                            </span>
                          </span>
                        </td>
                        <td><span className="num">{fmtQty(qty)}</span></td>
                        <td>
                          <span className="positions-split">
                            <b className="num">{fmtQty(p.free)}</b>
                            <em className="num">{fmtQty(p.locked)} locked</em>
                          </span>
                        </td>
                        <td><span className="num">{fmtPrice(p.priceUsdt)}</span></td>
                        <td className="positions-notional"><span className="num">{fmtPrice(p.valueUsdt)}</span></td>
                        <td className={p.avgCost === null ? 'muted' : ''}>
                          <span className="num">{p.avgCost !== null ? fmtPrice(p.avgCost) : '— no fills'}</span>
                        </td>
                        <td className={p.unrealizedUsd !== null ? signClass(p.unrealizedUsd) : 'muted'}>
                          <span className="num">{p.unrealizedUsd !== null ? fmtPrice(p.unrealizedUsd) : '—'}</span>
                        </td>
                        <td className={pnlPct !== null ? signClass(pnlPct) : 'muted'}>
                          <span className="num">{pnlPct !== null ? fmtPct(pnlPct) : '—'}</span>
                        </td>
                        <td className="l">
                          <span className="positions-row-actions">
                            <button
                              className="mini-btn"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetail(`${p.asset}USDT`);
                              }}
                            >
                              Market
                            </button>
                            <button
                              className="mini-btn danger"
                              type="button"
                              disabled={qty <= 0}
                              title={qty <= 0 ? 'No available quantity' : `Open a SELL ticket for ${p.asset}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openTicket({ symbol: `${p.asset}USDT`, side: 'SELL', source: 'manual' });
                              }}
                            >
                              Sell
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
        </main>

        <aside className="positions-rail">
          <section className="positions-side card">
            <div className="positions-rail-head">
              <h2>Readiness</h2>
              <span>what must be true before this becomes live account intelligence</span>
            </div>
            <div className="positions-ready-list">
              <ReadinessStep
                n="1"
                label="Server-side keys"
                detail={keysPresent ? 'read keys are configured' : 'keys are absent; no frontend key input'}
                tone={keysPresent ? 'ok' : 'idle'}
              />
              <ReadinessStep
                n="2"
                label="Balances"
                detail={positions.length ? `${positions.length} non-USDT holdings loaded` : 'positions stay empty until balances sync'}
                tone={positions.length ? 'ok' : keysPresent ? 'warn' : 'idle'}
              />
              <ReadinessStep
                n="3"
                label="Fill cost basis"
                detail={totals.knownPnl ? `${totals.knownPnl} assets have avg cost` : 'import fills to unlock PnL accuracy'}
                tone={totals.knownPnl ? 'ok' : 'idle'}
              />
              <ReadinessStep
                n="4"
                label="Futures leg"
                detail="liquidation and margin fields wait for verified testnet/live path"
                tone="idle"
              />
            </div>
          </section>

          <section className="positions-side card">
            <div className="positions-rail-head">
              <h2>Desk actions</h2>
              <span>working routes only</span>
            </div>
            <div className="positions-action-list">
              <button type="button" onClick={() => setPage('trade')}>
                <span><IconTicket size={15} /> Open manual ticket</span>
                <b>trade</b>
              </button>
              <button type="button" onClick={() => setPage('fills')}>
                <span><IconBook size={15} /> Import fills</span>
                <b>fills</b>
              </button>
              <button type="button" onClick={() => setPage('ledger')}>
                <span><IconPulse size={15} /> Ledger trail</span>
                <b>audit</b>
              </button>
              <button type="button" onClick={() => setPage('risk')}>
                <span><IconShield size={15} /> Risk settings</span>
                <b>gate</b>
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
