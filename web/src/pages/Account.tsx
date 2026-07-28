import { useRef, useState } from 'react';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPrice, timeAgo } from '../format';
import { exactOrDash, projectPrivateReadGuard } from '../lib/privateRead';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import './Account.css';

export type AccountView = 'overview' | 'execution' | 'orders' | 'positions' | 'fills' | 'pnl';
type RangeId = '1W' | '1M' | '3M' | '6M';

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
  const { privateRead, privateReadError, privateReadSource, setPage } = useStore();
  const [range, setRange] = useState<RangeId>('6M');
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const guard = projectPrivateReadGuard({
    snapshot: privateRead,
    source: privateReadSource,
    error: privateReadError,
  });
  const { presentation, errorFact } = guard;
  const historyPoints: { ts: number; v: number }[] = [];
  const openOrders = [
    ...(privateRead.spot.openOrders ?? []).map((order) => ({ ...order, product: 'Spot', positionSide: null as string | null, reduceOnly: null as boolean | null })),
    ...(privateRead.margin.openOrders ?? []).map((order) => ({ ...order, product: 'Margin', positionSide: null as string | null, reduceOnly: null as boolean | null })),
    ...(privateRead.usdm.openOrders ?? []).map((order) => ({ ...order, product: 'USD-M', positionSide: order.positionSide, reduceOnly: order.reduceOnly })),
  ];
  const ordersAvailable = privateRead.spot.openOrders !== null
    && privateRead.margin.openOrders !== null
    && privateRead.usdm.openOrders !== null;
  const visibleFills = [
    ...(privateRead.spot.fills ?? []).map((fill) => ({
      ...fill, product: 'Spot', side: fill.isBuyer ? 'BUY' : 'SELL', realizedPnl: null as string | null,
    })),
    ...(privateRead.margin.fills ?? []).map((fill) => ({
      ...fill, product: 'Margin', side: fill.isBuyer ? 'BUY' : 'SELL', realizedPnl: null as string | null,
    })),
    ...(privateRead.usdm.fills ?? []).map((fill) => ({
      ...fill, product: 'USD-M', side: fill.side, realizedPnl: fill.realizedPnl,
    })),
  ];
  const fillsAvailable = privateRead.spot.fills !== null
    && privateRead.margin.fills !== null
    && privateRead.usdm.fills !== null;
  const positions = privateRead.usdm.positions;
  const walletRows = [
    ...(privateRead.spot.balances ?? []).map((balance) => ({
      id: `spot-${balance.asset}`,
      product: 'Spot',
      asset: balance.asset,
      first: balance.free,
      firstLabel: 'Available',
      second: balance.locked,
      secondLabel: 'Locked',
      third: '—',
      thirdLabel: 'Liability Not Applicable',
      fourth: privateRead.spot.state,
      fourthLabel: privateRead.spot.coverage.state.replaceAll('_', ' '),
    })),
    ...(privateRead.margin.assets ?? []).map((asset) => ({
      id: `margin-${asset.asset}`,
      product: 'Margin',
      asset: asset.asset,
      first: asset.free,
      firstLabel: 'Available',
      second: asset.locked,
      secondLabel: 'Locked',
      third: `${asset.borrowed} / ${asset.interest}`,
      thirdLabel: 'Borrowed / Interest',
      fourth: asset.netAsset,
      fourthLabel: 'Net Asset',
    })),
    ...(privateRead.usdm.balances ?? []).map((balance) => ({
      id: `usdm-${balance.asset}`,
      product: 'USD-M',
      asset: balance.asset,
      first: balance.availableBalance,
      firstLabel: 'Available',
      second: balance.crossWalletBalance,
      secondLabel: 'Cross Wallet',
      third: balance.crossUnPnl,
      thirdLabel: 'Cross Unrealized PnL',
      fourth: balance.balance,
      fourthLabel: 'Wallet Balance',
    })),
  ];
  const walletRowsAvailable = privateRead.spot.balances !== null
    || privateRead.margin.assets !== null
    || privateRead.usdm.balances !== null;

  const toggleMask = () => {
    setMask((current) => {
      localStorage.setItem('cosmos-balance-mask', current ? '0' : '1');
      return !current;
    });
  };
  const exact = (value: string | null | undefined, hidden = '••••') => mask ? hidden : exactOrDash(value);

  const currentRange = RANGES.find((item) => item.id === range) ?? RANGES[1];
  const reconciliationReason = Object.values(privateRead.reconciliation)
    .find((fact) => fact.reason !== null)?.reason ?? null;
  const sourceReason = errorFact.id !== 'NONE'
    ? errorFact.detail
    : presentation.freshness.state !== 'CURRENT'
      ? presentation.freshness.reason
      : guard.reconciliationTone === 'bad' || guard.reconciliationTone === 'warn'
        ? reconciliationReason ?? presentation.reconciliationLabel
        : guard.coverageTone === 'bad' || guard.coverageTone === 'warn'
          ? presentation.coverageLabel
          : guard.sourceGuardTone === 'warn'
            ? 'Applied from the bounded fallback account endpoint.'
            : 'Preferred private-read account truth is current.';
  const sourceClass = guard.overallTone === 'ok'
    ? 'on'
    : guard.overallTone === 'warn'
      ? 'partial'
      : guard.overallTone === 'bad' ? 'bad' : 'loading';
  const sourceLabel = `Private Reads ${guard.statusLabel}`;
  const accountFactsAuthoritative = guard.overallTone === 'ok';
  const observationLabel = presentation.freshness.state === 'CURRENT'
    ? 'CURRENT'
    : presentation.freshness.state === 'STALE'
      ? 'STALE LAST-KNOWN'
      : `FRESHNESS ${presentation.freshness.state}`;
  const collectionCount = (available: boolean, count: number, label: string) => {
    if (!available) return '—';
    if (count === 0 && !accountFactsAuthoritative) return '—';
    const suffix = label ? ` ${label}` : '';
    return `${count}${suffix}`;
  };
  const emptySetTitle = (currentTitle: string, retainedTitle: string) => accountFactsAuthoritative
    ? currentTitle
    : presentation.freshness.state === 'CURRENT'
      ? 'Current Absence Unknown'
      : retainedTitle;
  const retainedEmptyDetail = presentation.freshness.state === 'CURRENT'
    ? `${guard.statusLabel} · the admitted collection was exact empty, but the complete guard does not prove current absence.`
    : `${observationLabel} · current absence UNKNOWN; the last admitted collection was exact empty.`;
  const guardedCollectionCount = (available: boolean, count: number) => !available
    || (count === 0 && !accountFactsAuthoritative)
    ? null
    : count;
  const rowCount = view === 'orders'
    ? guardedCollectionCount(ordersAvailable, openOrders.length)
    : view === 'fills'
      ? guardedCollectionCount(fillsAvailable, visibleFills.length)
      : view === 'positions'
        ? guardedCollectionCount(positions !== null, positions?.length ?? 0)
        : null;
  const rowLabel = view === 'orders' ? 'Orders' : view === 'fills' ? 'Fills' : null;

  return (
    <div className="container page accountx-page">
      <section className="accountx-frame" aria-label="account workspace">
        <header className="accountx-toolbar">
          <div className="accountx-identity">
            <span className="accountx-source-mark"><img className="accountx-page-mark" src="/account-wallet.png" alt="" aria-hidden="true" /></span>
            <span><h1>Account</h1><small>Private Account Reads · {guard.statusLabel} · {presentation.observedLabel}</small></span>
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
            <strong>{mask ? '••••••' : '—'}</strong>
            <small>No cross-product valuation is published by private-read v1</small>
          </article>
          <article>
            <span>Available USDT</span>
            <strong>{exact(presentation.spotAvailableUsdt, '••••••')}</strong>
            <small>{observationLabel} · {privateRead.spot.state} · Spot free balance only</small>
          </article>
          <article>
            <span>Margin Liabilities</span>
            <strong>{exact(presentation.marginLiabilityBtc, '••••••')}</strong>
            <small>{presentation.marginLiabilityBtc === null ? '— · liability aggregate unavailable' : `${observationLabel} · BTC-denominated provider aggregate`}</small>
          </article>
          <article title={presentation.freshness.reason}>
            <span>Reconciliation</span>
            <strong>{presentation.reconciliationLabel}</strong>
            <small>{presentation.coverageLabel} · {presentation.freshness.label}</small>
          </article>
        </section>

        <ProductSurfaceAdapter surfaceId="account" />

        <nav className="accountx-viewbar" aria-label="Account Views">
          <div role="tablist">
            {([
              ['overview', 'Overview', ''],
              ['execution', 'Execution', ''],
              ['orders', 'Open Orders', collectionCount(ordersAvailable, openOrders.length, '')],
              ['positions', 'Positions', collectionCount(positions !== null, positions?.length ?? 0, '')],
              ['fills', 'Recent Fills', collectionCount(fillsAvailable, visibleFills.length, '')],
              ['pnl', 'PnL', ''],
            ] as [AccountView, string, string][]).map(([id, label, count]) => (
              <button type="button" role="tab" key={id} aria-selected={view === id} onClick={() => setPage(id === 'overview' ? 'account' : id)}>
                {label}{count && <span>{count}</span>}
              </button>
            ))}
          </div>
          <span className={`accountx-source-state ${sourceClass}`} title={sourceReason}><i />{sourceLabel}</span>
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
                    <span><b>Spot Balance History</b><small>History is outside private-read v1 · admitted balance facts remain separate</small></span>
                    <div className="accountx-equity-tools">
                      <span className="accountx-spot-change">
                        <em>Spot Change</em>
                        <b>{mask ? '••••' : '—'}</b>
                      </span>
                      <div className="accountx-ranges" role="tablist" aria-label="History Range">
                        {RANGES.map((item) => <button type="button" role="tab" aria-selected={range === item.id} key={item.id} onClick={() => setRange(item.id)}>{item.id}</button>)}
                      </div>
                    </div>
                  </div>
                  <SpotBalanceChart points={historyPoints} rangeMs={currentRange.ms} hidden={mask} />
                </div>
                <aside className="accountx-allocation">
                  <div className="accountx-section-head"><span><b>Wallet Inventory</b><small>{observationLabel} · {presentation.coverageLabel}</small></span></div>
                  {mask
                    ? <div className="accountx-private">Balances Hidden</div>
                    : <div className="accountx-empty compact"><b>{walletRowsAvailable ? `${walletRows.length} Observed Asset Rows` : 'Wallet Facts Unavailable'}</b><span>Spot, Margin, and USD-M quantities retain their provider units; no cross-product allocation is inferred.</span></div>}
                </aside>
              </section>

              <section className="accountx-wallet-zone" aria-label="Capital Accounts">
              <header className="accountx-wallet-zone-head">
                <span><b>Capital Accounts</b><small>{observationLabel} · Spot, Cross Margin, And USD-M facts</small></span>
                <em>{collectionCount(walletRowsAvailable, walletRows.length, 'Rows')}</em>
              </header>
              <div className="accountx-wallet-table">
                {walletRows.map((row) => (
                  <div className="accountx-wallet-item" key={row.id}>
                    <div className="accountx-wallet-row">
                      <span className="accountx-wallet-name"><TokenIcon symbol={`${row.asset}USDT`} size={28} /><span><b>{row.asset}</b><small>{row.product}</small></span></span>
                      <span><b>{exact(row.first)}</b><small>{row.firstLabel}</small></span>
                      <span><b>{exact(row.second)}</b><small>{row.secondLabel}</small></span>
                      <span><b>{exact(row.third)}</b><small>{row.thirdLabel}</small></span>
                      <span><b>{exact(row.fourth)}</b><small>{row.fourthLabel}</small></span>
                    </div>
                  </div>
                ))}
                {!walletRowsAvailable && <div className="accountx-empty"><b>Private Wallet Facts Unavailable</b><span>{sourceReason}; missing balances are not interpreted as zero.</span></div>}
                {walletRowsAvailable && walletRows.length === 0 && (
                  <div className="accountx-empty">
                    <b>{emptySetTitle('No Observed Asset Rows', 'Last Admitted Wallet Set Was Empty')}</b>
                    <span>{accountFactsAuthoritative ? 'The current configured private read returned exact empty account arrays.' : retainedEmptyDetail}</span>
                  </div>
                )}
              </div>
            </section>
            </section>
          )}

          {view === 'orders' && (
            <section className="accountx-table-view" aria-label="Open Orders">
              <header className="accountx-data-view-head"><span><b>Open Orders</b><small>{observationLabel} · Spot, Cross Margin, And USD-M readback · no action controls</small></span><em>{collectionCount(ordersAvailable, openOrders.length, 'Orders')}</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table orders">
                <thead><tr><th className="l">Order</th><th>Price</th><th>Quantity</th><th>Filled</th><th>Status</th><th>Age</th></tr></thead>
                <tbody>{openOrders.map((order) => (
                  <tr key={`${order.product}-${order.symbol}-${order.orderId}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={order.symbol} size={36} /><span><b>{order.symbol}</b><small><em className={order.side === 'BUY' ? 'up' : 'down'}>{order.side}</em> · {order.product} · {order.type}</small></span></span></td>
                    <td><b>{exact(order.price)}</b><small>Limit Price</small></td>
                    <td><b>{exact(order.origQty)}</b><small>Original Quantity</small></td>
                    <td><b>{exact(order.executedQty)}</b><small>Executed Quantity</small></td>
                    <td><b>{order.status}</b><small>Binance Open Order</small></td>
                    <td><b>{timeAgo(order.time)}</b><small>Order {order.orderId}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {!ordersAvailable && <div className="accountx-empty"><b>Open Order Facts Unavailable</b><span>{sourceReason}; absence is not interpreted as zero.</span></div>}
              {ordersAvailable && openOrders.length === 0 && (
                <div className="accountx-empty">
                  <b>{emptySetTitle('No Open Orders', 'Last Admitted Open-Order Set Was Empty')}</b>
                  <span>{accountFactsAuthoritative ? 'All three current configured product reads returned exact empty open-order arrays.' : retainedEmptyDetail}</span>
                </div>
              )}
              </div>
            </section>
          )}

          {view === 'positions' && (
            <section className="accountx-table-view" aria-label="USD-M Positions">
              <header className="accountx-data-view-head"><span><b>USD-M Positions</b><small>{observationLabel} · position facts only · no leverage or order controls</small></span><em>{collectionCount(positions !== null, positions?.length ?? 0, 'Positions')}</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table fills">
                <thead><tr><th className="l">Position</th><th>Amount</th><th>Entry</th><th>Mark</th><th>Unrealized PnL</th><th>Updated</th></tr></thead>
                <tbody>{positions?.map((position) => (
                  <tr key={`${position.symbol}-${position.positionSide}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={position.symbol} size={36} /><span><b>{position.symbol}</b><small>{position.positionSide} · {position.marginType ?? 'Margin Mode Not Published'}</small></span></span></td>
                    <td><b>{exact(position.positionAmt)}</b><small>Position Amount</small></td>
                    <td><b>{exact(position.entryPrice)}</b><small>Entry Price</small></td>
                    <td><b>{exact(position.markPrice)}</b><small>Mark Price</small></td>
                    <td><b>{exact(position.unRealizedProfit)}</b><small>USD-M Provider Fact</small></td>
                    <td><b>{timeAgo(position.updateTime)}</b><small>{position.leverage === null ? 'Leverage — · Not Published By Position V3' : `Leverage ${position.leverage}`}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {positions === null && <div className="accountx-empty"><b>Position Facts Unavailable</b><span>{sourceReason}; absence is not interpreted as zero.</span></div>}
              {positions?.length === 0 && (
                <div className="accountx-empty">
                  <b>{emptySetTitle('No USD-M Positions', 'Last Admitted USD-M Position Set Was Empty')}</b>
                  <span>{accountFactsAuthoritative ? 'The current configured USD-M read returned an exact empty position array.' : retainedEmptyDetail}</span>
                </div>
              )}
              </div>
            </section>
          )}

          {view === 'fills' && (
            <section className="accountx-table-view" aria-label="Recent Fills">
              <header className="accountx-data-view-head"><span><b>Recent Fills</b><small>{observationLabel} · symbol-scoped provider history · coverage remains explicit</small></span><em>{collectionCount(fillsAvailable, visibleFills.length, 'Fills')}</em></header>
              <div className="accountx-table-scroll"><table className="accountx-table fills">
                <thead><tr><th className="l">Fill</th><th>Price</th><th>Quantity</th><th>Value</th><th>Fee</th><th>Time</th></tr></thead>
                <tbody>{visibleFills.map((fill) => (
                  <tr key={`${fill.product}-${fill.symbol}-${fill.id}`}>
                    <td className="l"><span className="accountx-order"><TokenIcon symbol={fill.symbol} size={36} /><span><b>{fill.symbol}</b><small><em className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side}</em> · {fill.product}</small></span></span></td>
                    <td><b>{exact(fill.price)}</b><small>Execution Price</small></td>
                    <td><b>{exact(fill.qty)}</b><small>Quantity</small></td>
                    <td><b>{exact(fill.quoteQty)}</b><small>Quote Value</small></td>
                    <td><b>{exact(fill.commission)}</b><small>{fill.commissionAsset}</small></td>
                    <td><b>{timeAgo(fill.time)}</b><small>Trade {fill.id}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {!fillsAvailable && <div className="accountx-empty"><b>Fill Facts Unavailable</b><span>{sourceReason}; absence is not interpreted as zero.</span></div>}
              {fillsAvailable && visibleFills.length === 0 && (
                <div className="accountx-empty">
                  <b>{emptySetTitle('No Scoped Fill Rows', 'Last Admitted Scoped Fill Set Was Empty')}</b>
                  <span>{accountFactsAuthoritative ? 'The current configured symbol scopes returned exact empty fill arrays.' : retainedEmptyDetail}</span>
                </div>
              )}
              </div>
            </section>
          )}
        </div>

        <footer className="accountx-footer">
          <span>
            Private Read {guard.statusLabel} · Coverage {presentation.coverageLabel} · Reconciliation {presentation.reconciliationLabel} · Source {privateReadSource} · Execution BLOCKED
          </span>
          {rowCount !== null && rowLabel && <span>{rowCount} {rowLabel}</span>}
        </footer>
      </section>
    </div>
  );
}
