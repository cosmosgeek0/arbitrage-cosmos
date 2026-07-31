import { useState } from 'react';
import { TokenIcon } from '../components/TokenIcon';
import { timeAgo } from '../format';
import { exactOrDash, projectPrivateRead } from '../lib/privateRead';
import { useStore } from '../store';
import { ProductSurfaceAdapter } from '../features/productControlRoom/components/SurfaceBindingPanel';
import {
  projectAccountTruth,
  type AccountDataset,
} from './accountTruth';
import './Account.css';

export type AccountView = 'overview' | 'execution' | 'orders' | 'positions' | 'fills' | 'pnl';
export type AccountCanonicalSurfaceId = 'account' | 'execution' | 'orders' | 'positions' | 'fills' | 'pnl';

export type AccountViewContract = Readonly<{
  title: 'Account' | 'Execution' | 'Open Orders' | 'Positions' | 'Recent Fills' | 'PnL';
  page: 'account' | 'execution' | 'orders' | 'positions' | 'fills' | 'pnl';
  surfaceId: AccountCanonicalSurfaceId;
  readOnly: true;
  actionControls: false;
}>;

const ACCOUNT_VIEW_CONTRACTS: Readonly<Record<AccountView, AccountViewContract>> = Object.freeze({
  overview: Object.freeze({ title: 'Account', page: 'account', surfaceId: 'account', readOnly: true, actionControls: false }),
  execution: Object.freeze({ title: 'Execution', page: 'execution', surfaceId: 'execution', readOnly: true, actionControls: false }),
  orders: Object.freeze({ title: 'Open Orders', page: 'orders', surfaceId: 'orders', readOnly: true, actionControls: false }),
  positions: Object.freeze({ title: 'Positions', page: 'positions', surfaceId: 'positions', readOnly: true, actionControls: false }),
  fills: Object.freeze({ title: 'Recent Fills', page: 'fills', surfaceId: 'fills', readOnly: true, actionControls: false }),
  pnl: Object.freeze({ title: 'PnL', page: 'pnl', surfaceId: 'pnl', readOnly: true, actionControls: false }),
});

const ACCOUNT_TAB_PAGES: Readonly<Record<AccountView, AccountViewContract['page']>> = Object.freeze({
  overview: 'account',
  execution: 'execution',
  orders: 'orders',
  positions: 'positions',
  fills: 'fills',
  pnl: 'pnl',
});

export function accountViewContract(view: AccountView): AccountViewContract {
  return ACCOUNT_VIEW_CONTRACTS[view];
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.35" fill="none" stroke="currentColor" strokeWidth="1.45" />
      {off && <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />}
    </svg>
  );
}

function exactObservation(timestamp: number | null): string {
  if (timestamp === null) return 'No Observation Time';
  return new Date(timestamp).toLocaleString();
}

function tabCount<T>(dataset: AccountDataset<T>): string {
  if (dataset.rows.length > 0) return String(dataset.rows.length);
  return dataset.exactEmptyCurrent ? '0' : '—';
}

function DatasetNotice<T>({
  dataset,
  noun,
  exactEmptyTitle,
  sourceReason,
  scoped = false,
}: {
  readonly dataset: AccountDataset<T>;
  readonly noun: string;
  readonly exactEmptyTitle: string;
  readonly sourceReason: string;
  readonly scoped?: boolean;
}) {
  const sourceClause = sourceReason.replace(/[.;\s]+$/u, '');
  if (dataset.exactEmptyCurrent) {
    return (
      <div className="accountx-empty">
        <b>{exactEmptyTitle}</b>
        <span>{scoped
          ? 'Every current product read returned an exact empty array inside its published symbol scope.'
          : 'Every current product read returned an exact empty array.'}</span>
      </div>
    );
  }
  if (dataset.state === 'UNAVAILABLE') {
    return (
      <div className="accountx-empty">
        <b>{noun} Facts Unavailable</b>
        <span>{sourceClause}; absence is not interpreted as zero.</span>
      </div>
    );
  }
  if (dataset.state === 'PARTIAL_SOURCES') {
    return (
      <div className="accountx-empty compact">
        <b>Partial {noun} Sources</b>
        <span>{dataset.sourceLabel}. Visible rows retain exact provider values; missing sources remain unknown.</span>
      </div>
    );
  }
  if (dataset.retained) {
    return (
      <div className="accountx-empty compact">
        <b>Retained Last-Known {noun}</b>
        <span>{sourceReason} A current empty-state claim is not authorized.</span>
      </div>
    );
  }
  if (!dataset.allSourcesCurrent) {
    return (
      <div className="accountx-empty compact">
        <b>{dataset.rows.length > 0 ? `Last Observed ${noun}` : `Current ${noun} Absence Unproven`}</b>
        <span>{sourceReason} Exact rows remain visible, but they are not relabeled as current.</span>
      </div>
    );
  }
  return null;
}

export function Account({ view = 'overview' }: { readonly view?: AccountView }) {
  const {
    privateRead,
    privateReadError,
    privateReadSource,
    stateStatus,
    stateLastSuccessAtMs,
    stateError,
    setPage,
  } = useStore();
  const [mask, setMask] = useState(() => localStorage.getItem('cosmos-balance-mask') === '1');
  const viewContract = accountViewContract(view);
  const presentation = projectPrivateRead(privateRead);
  // The page-local projection fail-closes presentation.freshness.state,
  // presentation.freshness.label, and presentation.freshness.reason against
  // the shared transport receipt before any freshness claim renders.
  const account = projectAccountTruth({
    snapshot: privateRead,
    presentation,
    source: privateReadSource,
    privateReadError,
    stateStatus,
    stateLastSuccessAtMs,
    stateError,
  });

  // These source counts make partial product truth explicit at the page
  // boundary. A null source stays a dash while rows from its available siblings
  // remain visible through the page-local adapter.
  const orderProductReads = [
    ['Spot', privateRead.spot.openOrders],
    ['Margin', privateRead.margin.openOrders],
    ['USD-M', privateRead.usdm.openOrders],
  ] as const;
  const fillProductReads = [
    ['Spot', privateRead.spot.fills],
    ['Margin', privateRead.margin.fills],
    ['USD-M', privateRead.usdm.fills],
  ] as const;
  const orderProductLabel = orderProductReads
    .map(([product, rows]) => `${product} ${rows === null ? '—' : rows.length}`)
    .join(' · ');
  const fillProductLabel = fillProductReads
    .map(([product, rows]) => `${product} ${rows === null ? '—' : rows.length}`)
    .join(' · ');
  const openOrders = [
    ...account.orders.rows,
  ];
  const visibleFills = [...account.fills.rows];
  const positions = account.positions.rows;
  const walletRows = account.wallets.rows;

  const toggleMask = () => {
    setMask((current) => {
      localStorage.setItem('cosmos-balance-mask', current ? '0' : '1');
      return !current;
    });
  };
  const exact = (value: string | null | undefined, hidden = '••••') => mask ? hidden : exactOrDash(value);
  const sourceReason = account.sourceReason;
  const sourceLabel = account.sourceLabel;
  const observationSummary = account.observedLabel === account.freshnessLabel
    ? account.freshnessLabel
    : `${account.observedLabel} · ${account.freshnessLabel}`;
  const rowDataset = view === 'orders'
    ? account.orders
    : view === 'fills'
      ? account.fills
      : view === 'positions'
        ? account.positions
        : null;
  const rowLabel = view === 'orders' ? 'Observed Orders' : view === 'fills' ? 'Observed Fills' : view === 'positions' ? 'Provider Position Rows' : null;
  const accountStatus = privateRead.state === 'NOT_CONFIGURED'
    ? 'Account Read Not Configured'
    : `Private Account Reads · ${account.stateLabel} · ${observationSummary}`;
  const pageStatus = view === 'overview'
    ? accountStatus
    : `Canonical Read-Only Projection · ${accountStatus}`;

  return (
    <div className="container page accountx-page">
      <section className="accountx-frame" aria-label="account workspace">
        <header className="accountx-toolbar">
          <div className="accountx-identity">
            <span className="accountx-source-mark"><img className="accountx-page-mark" src="/account-wallet.png" alt="" aria-hidden="true" /></span>
            <span>
              <h1>{viewContract.title}</h1>
              <small>{pageStatus}</small>
            </span>
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
            <small>{account.retained ? 'LAST-KNOWN' : privateRead.spot.state} · Spot free balance only</small>
          </article>
          <article>
            <span>Margin Liabilities</span>
            <strong>{exact(presentation.marginLiabilityBtc, '••••••')}</strong>
            <small>{presentation.marginLiabilityBtc === null ? '— · liability aggregate unavailable' : `${account.retained ? 'LAST-KNOWN · ' : ''}BTC-denominated provider aggregate`}</small>
          </article>
          <article title={account.freshnessReason}>
            <span>Reconciliation</span>
            <strong>{presentation.reconciliationLabel}</strong>
            <small>{presentation.coverageLabel} · {account.freshnessLabel}</small>
          </article>
        </section>

        <ProductSurfaceAdapter surfaceId="account" />

        <nav className="accountx-viewbar" aria-label="Account Views">
          <div role="tablist" aria-label="Private Account Reads">
            {([
              ['overview', 'Overview', ''],
              ['execution', 'Execution', ''],
              ['orders', 'Open Orders', tabCount(account.orders)],
              ['positions', 'Positions', tabCount(account.positions)],
              ['fills', 'Recent Fills', tabCount(account.fills)],
              ['pnl', 'PnL', ''],
            ] as [AccountView, string, string][]).map(([id, label, count]) => (
              <button
                type="button"
                role="tab"
                key={id}
                id={`accountx-tab-${id}`}
                aria-controls={`accountx-panel-${id}`}
                aria-selected={view === id}
                onClick={() => setPage(ACCOUNT_TAB_PAGES[id])}
              >
                {label}{count && <span>{count}</span>}
              </button>
            ))}
          </div>
          <span
            className={`accountx-source-state ${account.sourceClass}`}
            data-private-read-guard-tone={account.guardTone}
            title={sourceReason}
          >
            <i />{sourceLabel}
          </span>
        </nav>

        <div
          className="accountx-workspace"
          role="tabpanel"
          id={`accountx-panel-${view}`}
          aria-labelledby={`accountx-tab-${view}`}
          tabIndex={0}
        >
          {view === 'execution' && <ProductSurfaceAdapter surfaceId="execution" />}
          {view === 'orders' && <ProductSurfaceAdapter surfaceId="orders" />}
          {view === 'positions' && <ProductSurfaceAdapter surfaceId="positions" />}
          {view === 'fills' && <ProductSurfaceAdapter surfaceId="fills" />}
          {view === 'pnl' && <ProductSurfaceAdapter surfaceId="pnl" />}

          {view === 'overview' && (
            <section className="accountx-overview" aria-label="Portfolio Overview">
              <section className="accountx-portfolio-band" aria-label="Account Readback">
                <div className="accountx-equity">
                  <div className="accountx-section-head">
                    <span><b>Account Truth Receipt</b><small>Shared Account readback · no page-local transport</small></span>
                  </div>
                  <div className="accountx-empty compact" title={sourceReason}>
                    <b>{sourceLabel}</b>
                    <span>{sourceReason}</span>
                  </div>
                </div>
                <aside className="accountx-allocation">
                  <div className="accountx-section-head"><span><b>Wallet Inventory</b><small>{account.wallets.sourceLabel}</small></span></div>
                  {mask
                    ? <div className="accountx-private">Balances Hidden</div>
                    : <div className="accountx-empty compact"><b>{account.wallets.countLabel}</b><span>Spot, Margin, and USD-M quantities retain provider units; no cross-product allocation is inferred.</span></div>}
                </aside>
              </section>

              <section className="accountx-wallet-zone" aria-label="Capital Accounts">
                <header className="accountx-wallet-zone-head">
                  <span><b>Capital Accounts</b><small>{account.wallets.sourceLabel}</small></span>
                  <em>{account.wallets.countLabel}</em>
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
                  <DatasetNotice dataset={account.wallets} noun="Wallet" exactEmptyTitle="No Observed Asset Rows" sourceReason={sourceReason} />
                </div>
              </section>

              <section className="accountx-wallet-zone" aria-label="Account Freshness Facts">
                <header className="accountx-wallet-zone-head">
                  <span><b>Freshness Facts</b><small>Application receipt, account snapshot, and product-family observations</small></span>
                  <em>{account.freshnessFacts.length} Facts</em>
                </header>
                <div className="accountx-wallet-table">
                  {account.freshnessFacts.map((fact) => (
                    <div className="accountx-wallet-item" key={fact.id} title={fact.detail}>
                      <div className="accountx-wallet-row">
                        <span className="accountx-wallet-name"><span><b>{fact.label}</b><small>{fact.scope}</small></span></span>
                        <span><b>{fact.stateLabel}</b><small>Read State</small></span>
                        <span title={exactObservation(fact.observedAt)}><b>{fact.observedLabel}</b><small>Observed</small></span>
                        <span><b>{fact.coverageLabel}</b><small>Coverage / Owner</small></span>
                        <span><b>{fact.freshnessLabel}</b><small>Freshness</small></span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}

          {view === 'orders' && (
            <section className="accountx-table-view" aria-label="Open Orders">
              <header className="accountx-data-view-head">
                <span><b>Open Orders</b><small>{account.orders.sourceLabel} · {orderProductLabel} · no action controls</small></span>
                <em>{account.orders.countLabel}</em>
              </header>
              <div className="accountx-table-scroll">
                <table className="accountx-table orders">
                  <thead><tr><th className="l">Order</th><th>Price</th><th>Quantity</th><th>Filled</th><th>Status</th><th>Age</th></tr></thead>
                  <tbody>{openOrders.map((order) => (
                    <tr key={`${order.product}-${order.symbol}-${order.orderId}`}>
                      <td className="l"><span className="accountx-order"><TokenIcon symbol={order.symbol} size={36} /><span><b>{order.symbol}</b><small><em className={order.side === 'BUY' ? 'up' : 'down'}>{order.side}</em> · {order.product} · {order.type}</small></span></span></td>
                      <td><b>{exact(order.price)}</b><small>Limit Price</small></td>
                      <td><b>{exact(order.origQty)}</b><small>Original Quantity</small></td>
                      <td><b>{exact(order.executedQty)}</b><small>Executed Quantity</small></td>
                      <td><b>{order.status}</b><small>Provider Open Order</small></td>
                      <td><b>{timeAgo(order.time)}</b><small>Order {order.orderId}</small></td>
                    </tr>
                  ))}</tbody>
                </table>
                <DatasetNotice dataset={account.orders} noun="Open Order" exactEmptyTitle="No Open Orders In Current Product Reads" sourceReason={sourceReason} />
              </div>
            </section>
          )}

          {view === 'positions' && (
            <section className="accountx-table-view" aria-label="USD-M Positions">
              <header className="accountx-data-view-head">
                <span><b>USD-M Position Rows</b><small>{account.positions.sourceLabel} · Position V3 rows are not filtered by amount</small></span>
                <em>{account.positions.countLabel}</em>
              </header>
              <div className="accountx-table-scroll">
                <table className="accountx-table fills">
                  <thead><tr><th className="l">Position</th><th>Amount</th><th>Entry</th><th>Mark</th><th>Unrealized PnL</th><th>Updated</th></tr></thead>
                  <tbody>{positions.map((position) => (
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
                <DatasetNotice dataset={account.positions} noun="Position" exactEmptyTitle="No Current USD-M Position Rows" sourceReason={sourceReason} />
              </div>
            </section>
          )}

          {view === 'fills' && (
            <section className="accountx-table-view" aria-label="Recent Fills">
              <header className="accountx-data-view-head">
                <span><b>Recent Fills</b><small>{account.fills.sourceLabel} · {fillProductLabel} · symbol-scoped provider history</small></span>
                <em>{account.fills.countLabel}</em>
              </header>
              <div className="accountx-table-scroll">
                <table className="accountx-table fills">
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
                <DatasetNotice dataset={account.fills} noun="Fill" exactEmptyTitle="No Fills In Current Symbol Scopes" sourceReason={sourceReason} scoped />
              </div>
            </section>
          )}
        </div>

        <footer className="accountx-footer">
          <span>Private Read {account.stateLabel} · {presentation.reconciliationLabel} · Source {privateReadSource} · {viewContract.title} Read Only · No Account Action Controls</span>
          {rowDataset && rowLabel && (rowDataset.rows.length > 0 || rowDataset.exactEmptyCurrent) && <span>{rowDataset.rows.length} {rowLabel}</span>}
        </footer>
      </section>
    </div>
  );
}
