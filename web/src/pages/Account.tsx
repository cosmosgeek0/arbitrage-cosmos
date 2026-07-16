import { useEffect, useRef, useState } from 'react';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPct, fmtPrice, fmtQty, timeAgo } from '../format';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll } from '../lib/polling';
import { useRefreshSignal } from '../lib/refresh';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import type { FillRow, OpenOrderRow } from '../types';
import './Account.css';

export type AccountView = 'overview' | 'execution' | 'orders' | 'positions' | 'fills' | 'pnl';
type RangeId = '1W' | '1M' | '3M' | '6M';

const PRIVATE_SOURCE_DETAIL = 'NOT_CONFIGURED · private account reads are not mounted in this product.';
const RANGES: { id: RangeId; ms: number }[] = [
  { id: '1W', ms: 7 * 86_400_000 },
  { id: '1M', ms: 30 * 86_400_000 },
  { id: '3M', ms: 90 * 86_400_000 },
  { id: '6M', ms: 180 * 86_400_000 },
];

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.35" fill="none" stroke="currentColor" strokeWidth="1.45" />
      {off && <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />}
    </svg>
  );
}

function compactDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function samplePoints<T>(rows: T[], max = 54): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => rows[Math.round(index * step)]);
}

/** Spot-only history is intentionally named as such. Binance transfers,
 * borrowing, repayments, and wallet moves affect this line, so it must never
 * be presented as portfolio PnL. */
function SpotBalanceChart({
  points,
  rangeMs,
  hidden,
}: {
  points: { ts: number; v: number }[];
  rangeMs: number;
  hidden: boolean;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number; ts: number } | null>(null);

  if (hidden) return <div className="accountx-private">Balances Hidden</div>;

  const sorted = [...points].filter((point) => finite(point.v)).sort((a, b) => a.ts - b.ts);
  const end = Math.max(Date.now(), sorted[sorted.length - 1]?.ts ?? 0);
  const requestedStart = end - rangeMs;
  const first = sorted[0]?.ts ?? end;
  const start = Math.max(requestedStart, first);
  const visible = samplePoints(sorted.filter((point) => point.ts >= start));
  if (visible.length < 2) return <div className="accountx-empty compact"><b>History Not Configured</b><span>NOT_CONFIGURED · private balance history is not mounted.</span></div>;

  // A normalized plotting plane intentionally fills the CSS-owned canvas.
  // Keeping axes outside the SVG prevents preserveAspectRatio from centering a
  // shrunken chart when the account surface becomes much wider than it is tall.
  const width = 1000;
  const height = 164;
  const plotWidth = width;
  const values = visible.map((point) => point.v);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.max(1, maximum * 0.02);
  const low = Math.max(0, minimum - span * 0.12);
  const high = maximum + span * 0.12;
  const x = (timestamp: number) => ((timestamp - start) / Math.max(1, end - start)) * (plotWidth - 8) + 4;
  const y = (value: number) => height - 24 - ((value - low) / Math.max(1e-9, high - low)) * (height - 38);
  const path = visible.reduce((commands, point, index) => {
    const px = x(point.ts).toFixed(1);
    const py = y(point.v).toFixed(1);
    if (index === 0) return `M${px} ${py}`;
    const previousY = y(visible[index - 1].v).toFixed(1);
    return `${commands} L${px} ${previousY} L${px} ${py}`;
  }, '');
  const grid = Array.from({ length: 3 }, (_, index) => low + ((2 - index) / 2) * (high - low));
  const ticks = Array.from({ length: 5 }, (_, index) => start + (index / 4) * (end - start));

  const onMove = (event: { clientX: number }) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = start + fraction * (end - start);
    let closest = visible[0];
    for (const point of visible) if (Math.abs(point.ts - target) < Math.abs(closest.ts - target)) closest = point;
    setHover({ x: x(closest.ts) / width, value: closest.v, ts: closest.ts });
  };

  return (
    <div className="accountx-chart">
      <div className="accountx-chart-canvas" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Spot balance history">
          {grid.map((value) => (
            <line key={value} x1="0" x2={plotWidth} y1={y(value)} y2={y(value)} className="accountx-gridline" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={path} className="accountx-chart-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover && (
          <>
            <span className="accountx-crosshair" style={{ left: `${hover.x * 100}%` }} />
            <span className={`accountx-chart-tip ${hover.x > 0.76 ? 'flip' : ''}`} style={{ left: `${hover.x * 100}%` }}>
              <b>{fmtPrice(hover.value)}</b>
              <em>{new Date(hover.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</em>
            </span>
          </>
        )}
      </div>
      <div className="accountx-date-axis">{ticks.map((tick) => <span key={tick}>{compactDate(tick)}</span>)}</div>
    </div>
  );
}

export function Account({ view = 'overview' }: { readonly view?: AccountView }) {
  const { prefs, setPage } = useStore();
  const [range, setRange] = useState<RangeId>('6M');
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const [fills, setFills] = useState<FillRow[]>([]);
  const [fillsError, setFillsError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  useRefreshSignal(() => setRefreshTick((value) => value + 1));

  useEffect(() => {
    const poll = createSettledPoll<FillRow[]>({
      intervalMs: Math.max(5, prefs.dataCadence?.account ?? 10) * 1_000,
      request: (signal) => fetchJson<FillRow[]>('/api/fills', { cache: 'no-store', signal }),
      onSuccess: (rows) => {
        setFills(rows);
        setFillsError(null);
      },
      onError: (error) => {
        setFillsError(apiErrorMessage(error));
      },
    });
    poll.start();
    return poll.stop;
  }, [prefs.dataCadence?.account, refreshTick]);

  const historyPoints: { ts: number; v: number }[] = [];
  const [openOrders] = useState<OpenOrderRow[] | null>(null);
  const visibleFills = fills;

  const toggleMask = () => {
    setMask((current) => {
      localStorage.setItem('cosmos-balance-mask', current ? '0' : '1');
      return !current;
    });
  };
  const money = (value: number | null | undefined) => mask ? '••••••' : fmtPrice(value);
  const quantity = (value: number | null | undefined) => mask ? '••••' : fmtQty(value);

  const currentRange = RANGES.find((item) => item.id === range) ?? RANGES[1];
  const sourceErrors = [PRIVATE_SOURCE_DETAIL, fillsError].filter(Boolean) as string[];
  const sourceClass = 'partial';
  const sourceLabel = 'Private Reads NOT_CONFIGURED';
  const rowCount = view === 'orders' ? null : view === 'fills' ? visibleFills.length : null;
  const rowLabel = view === 'orders' ? 'Orders' : view === 'fills' ? 'Fills' : null;

  return (
    <div className="container page accountx-page">
      <section className="accountx-frame" aria-label="account workspace">
        <header className="accountx-toolbar">
          <div className="accountx-identity">
            <span className="accountx-source-mark"><img className="accountx-page-mark" src="/account-wallet.png" alt="" aria-hidden="true" /></span>
            <span><h1>Account</h1><small>Private Account Reads · NOT_CONFIGURED</small></span>
          </div>
          <div className="accountx-tools">
            <button type="button" className="accountx-mask" onClick={toggleMask} title={mask ? 'Show Balances' : 'Hide Balances'} aria-label={mask ? 'Show Balances' : 'Hide Balances'}>
              <EyeIcon off={mask} />
            </button>
          </div>
        </header>

        <section className="accountx-summary" aria-label="Account Summary">
          <article>
            <span>Estimated Total Value</span>
            <strong>{mask ? '••••••' : 'UNKNOWN'}</strong>
            <small>NOT_CONFIGURED · no private wallet aggregate is mounted</small>
          </article>
          <article>
            <span>Available Cash</span>
            <strong>{mask ? '••••••' : 'UNKNOWN'}</strong>
            <small>NOT_CONFIGURED · available balance is not read</small>
          </article>
          <article>
            <span>Liabilities</span>
            <strong>{mask ? '••••••' : 'UNKNOWN'}</strong>
            <small>OWNER_GATED · loan and liability reads are not mounted</small>
          </article>
          <article>
            <span>Gross Realized</span>
            <strong>UNKNOWN</strong>
            <small>NOT_CONFIGURED · private account PnL is not projected</small>
          </article>
        </section>

        <ProductSurfaceAdapter surfaceId="account" />

        <nav className="accountx-viewbar" aria-label="Account Views">
          <div role="tablist">
            {([
              ['overview', 'Overview', ''],
              ['execution', 'Execution', ''],
              ['orders', 'Open Orders', '—'],
              ['positions', 'Positions', ''],
              ['fills', 'Recent Fills', String(fills.length)],
              ['pnl', 'PnL', ''],
            ] as [AccountView, string, string][]).map(([id, label, count]) => (
              <button type="button" role="tab" key={id} aria-selected={view === id} onClick={() => setPage(id === 'overview' ? 'account' : id)}>
                {label}{count && <span>{count}</span>}
              </button>
            ))}
          </div>
          <span className={`accountx-source-state ${sourceClass}`} title={sourceErrors[0] ?? undefined}><i />{sourceLabel}</span>
        </nav>

        <div className="accountx-workspace">
          {view === 'execution' && <ProductSurfaceAdapter surfaceId="execution" />}
          {view === 'orders' && <ProductSurfaceAdapter surfaceId="orders" />}
          {view === 'positions' && <ProductSurfaceAdapter surfaceId="positions" />}
          {view === 'fills' && <ProductSurfaceAdapter surfaceId="fills" />}
          {view === 'pnl' && <ProductSurfaceAdapter surfaceId="pnl" />}

          {view === 'overview' && (
            <section className="accountx-overview" aria-label="Portfolio Overview">
              <section className="accountx-portfolio-band" aria-label="Balance And Allocation">
                <div className="accountx-equity">
                  <div className="accountx-section-head">
                    <span><b>Spot Balance History</b><small>NOT_CONFIGURED · private balance history is not mounted</small></span>
                    <div className="accountx-equity-tools">
                      <span className="accountx-spot-change">
                        <em>Spot Change</em>
                        <b>{mask ? '••••' : 'UNKNOWN'}</b>
                      </span>
                      <div className="accountx-ranges" role="tablist" aria-label="History Range">
                        {RANGES.map((item) => <button type="button" role="tab" aria-selected={range === item.id} key={item.id} onClick={() => setRange(item.id)}>{item.id}</button>)}
                      </div>
                    </div>
                  </div>
                  <SpotBalanceChart points={historyPoints} rangeMs={currentRange.ms} hidden={mask} />
                </div>
                <aside className="accountx-allocation">
                  <div className="accountx-section-head"><span><b>Wallet Allocation</b><small>NOT_CONFIGURED · no private wallet source</small></span></div>
                  {mask
                    ? <div className="accountx-private">Balances Hidden</div>
                    : <div className="accountx-empty compact"><b>Allocation Not Configured</b><span>Private wallet valuation is not mounted.</span></div>}
                </aside>
              </section>

              <section className="accountx-wallet-zone" aria-label="Capital Accounts">
              <header className="accountx-wallet-zone-head">
                <span><b>Capital Accounts</b><small>Private wallet, position, and liability reads are not mounted</small></span>
                <em>NOT_CONFIGURED</em>
              </header>
              <div className="accountx-wallet-table">
                <div className="accountx-empty"><b>Private Wallets Not Configured</b><span>No private endpoint is polled from this surface; missing balances are not interpreted as zero.</span></div>
              </div>
            </section>
            </section>
          )}

          {view === 'orders' && (
            <section className="accountx-table-view" aria-label="Open Orders">
              <header className="accountx-data-view-head"><span><b>Open Orders</b><small>OWNER_GATED · private order reads are not mounted</small></span><em>UNKNOWN</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table orders">
                <thead><tr><th className="l">Order</th><th>Price</th><th>Quantity</th><th>Filled</th><th>Status</th><th>Age</th></tr></thead>
                <tbody>{openOrders?.map((order: OpenOrderRow) => (
                  <tr key={`${order.symbol}-${order.orderId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={order.symbol} size={36} /><span><b>{order.symbol}</b><small><em className={order.side === 'BUY' ? 'up' : 'down'}>{order.side}</em> · {order.type}</small></span></span></td>
                    <td><b>{fmtPrice(order.price)}</b><small>Limit Price</small></td>
                    <td><b>{quantity(order.origQty)}</b><small>{order.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{fmtPct(order.origQty > 0 ? (order.executedQty / order.origQty) * 100 : 0, 0, false)}</b><small>{quantity(order.executedQty)} Filled</small></td>
                    <td><b className={order.stale ? 'warn' : 'ok'}>{order.stale ? 'Stale' : order.status}</b><small>Binance Open Order</small></td>
                    <td><b>{timeAgo(order.time)}</b><small>Order {order.orderId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {openOrders === null && <div className="accountx-empty"><b>Open Orders Not Configured</b><span>This surface does not poll a private order endpoint; absence is not interpreted as zero.</span></div>}
              </div>
            </section>
          )}

          {view === 'fills' && (
            <section className="accountx-table-view" aria-label="Recent Fills">
              <header className="accountx-data-view-head"><span><b>Recent Fills</b><small>Ledgered Binance executions with price, size, value, and fee evidence</small></span><em>{visibleFills.length} Fills</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table fills">
                <thead><tr><th className="l">Fill</th><th>Price</th><th>Quantity</th><th>Value</th><th>Fee</th><th>Time</th></tr></thead>
                <tbody>{visibleFills.map((fill) => (
                  <tr key={`${fill.symbol}-${fill.tradeId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={fill.symbol} size={36} /><span><b>{fill.symbol}</b><small><em className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side}</em> · {fill.source.replaceAll('_', ' ')}</small></span></span></td>
                    <td><b>{fmtPrice(fill.price)}</b><small>Execution Price</small></td>
                    <td><b>{quantity(fill.qty)}</b><small>{fill.symbol.replace(/USDT$/, '')}</small></td>
                    <td><b>{money(fill.quoteQty)}</b><small>Quote Value</small></td>
                    <td><b>{mask ? '••••' : fmtQty(fill.commission)}</b><small>{fill.commissionAsset ?? 'No Fee Asset'}</small></td>
                    <td><b>{timeAgo(fill.ts)}</b><small>Trade {fill.tradeId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {visibleFills.length === 0 && <div className="accountx-empty"><b>No Ledgered Fill Evidence</b><span>The local ledger currently contains no fill evidence; private streams are not consulted.</span></div>}
              </div>
            </section>
          )}
        </div>

        <footer className="accountx-footer">
          <span>
            Local Ledger {fillsError ? 'UNAVAILABLE' : 'READABLE'} · Private Account NOT_CONFIGURED · Execution OWNER_GATED
          </span>
          {rowCount !== null && rowLabel && <span>{rowCount} {rowLabel}</span>}
        </footer>
      </section>
    </div>
  );
}
