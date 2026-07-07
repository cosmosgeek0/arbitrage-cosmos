import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import {
  IconAlert,
  IconBook,
  IconChart,
  IconClock,
  IconPulse,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTicket,
} from '../components/Icons';
import { baseOf, fmtDateTime, fmtMoney, fmtPrice, fmtQty, timeAgo } from '../format';
import type { OpenOrderRow } from '../types';

type OrdersTab = 'open' | 'history';
type SideFilter = 'ALL' | 'BUY' | 'SELL';
type MsgTone = 'ok' | 'bad' | 'warn';

interface HistOrder {
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty?: string;
  status: string;
  time: number;
  updateTime?: number;
}

type AnyOrder = (OpenOrderRow | HistOrder) & { origin: 'open' | 'history' };

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function orderKey(order: Pick<AnyOrder, 'origin' | 'symbol' | 'orderId'>): string {
  return `${order.origin}-${order.symbol}-${order.orderId}`;
}

function orderNotional(order: OpenOrderRow | HistOrder): number {
  const quote = num((order as HistOrder).cummulativeQuoteQty);
  if (quote > 0) return quote;
  return num(order.price) * num(order.origQty);
}

function fillPct(order: OpenOrderRow | HistOrder): number {
  const qty = num(order.origQty);
  if (qty <= 0) return 0;
  return Math.max(0, Math.min(100, (num(order.executedQty) / qty) * 100));
}

function statusTone(status: string): 'ok' | 'bad' | 'warn' | 'idle' {
  if (status === 'FILLED') return 'ok';
  if (['REJECTED', 'EXPIRED'].includes(status)) return 'bad';
  if (['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'].includes(status)) return 'warn';
  return 'idle';
}

function isWorkingStatus(status: string): boolean {
  return ['NEW', 'PENDING_NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'].includes(status);
}

function remainingQty(order: OpenOrderRow | HistOrder): number {
  return Math.max(0, num(order.origQty) - num(order.executedQty));
}

function OrderDeskStat({
  label,
  value,
  sub,
  tone = 'idle',
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: 'ok' | 'bad' | 'warn' | 'idle';
}) {
  return (
    <div className={`order-desk-stat ${tone}`}>
      <em>{label}</em>
      <b className="num">{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function OrderBars({ orders }: { orders: AnyOrder[] }) {
  const recent = orders.slice(0, 26).reverse();
  const max = Math.max(1e-9, ...recent.map(orderNotional));
  if (recent.length === 0) {
    return (
      <div className="order-flow-empty">
        <span />
        <b>Order flow is ready.</b>
        <em>Open orders and loaded Binance history will form the tape here.</em>
      </div>
    );
  }
  return (
    <div className="order-flow-bars">
      {recent.map((o) => (
        <span key={orderKey(o)} className={`order-flow-bar ${o.side === 'BUY' ? 'buy' : 'sell'}`} title={`${o.side} ${o.symbol} ${fmtMoney(orderNotional(o))}`}>
          <i style={{ height: `${Math.max(8, (orderNotional(o) / max) * 100)}%` }} />
        </span>
      ))}
    </div>
  );
}

export function Orders() {
  const { state, cancelOrder, cancelAll, openLedger, openDetail, setPage } = useStore();
  const [tab, setTab] = useState<OrdersTab>('open');
  const [histSymbol, setHistSymbol] = useState('BTCUSDT');
  const [hist, setHist] = useState<HistOrder[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: MsgTone; text: string } | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<SideFilter>('ALL');
  const [status, setStatus] = useState('ALL');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const openOrders = useMemo<AnyOrder[]>(() => (state?.openOrders ?? []).map((o) => ({ ...o, origin: 'open' })), [state?.openOrders]);
  const histOrders = useMemo<AnyOrder[]>(() => (hist ?? []).map((o) => ({ ...o, origin: 'history' })), [hist]);
  const currentOrders = tab === 'open' ? openOrders : histOrders;
  const allKnownOrders = [...openOrders, ...histOrders];
  const keysPresent = !!state?.binance.keysPresent;
  const symbol = histSymbol.trim().toUpperCase();
  const symbolValid = /^[A-Z0-9]{5,20}$/.test(symbol);
  const historyDisabledReason = !keysPresent
    ? 'Server-side Binance keys are not configured'
    : !symbolValid
      ? 'Enter a Binance symbol such as BTCUSDT'
      : '';
  const modeLabel =
    state?.mode === 'LIVE_ARMED'
      ? 'Live armed'
      : state?.mode === 'MANUAL'
        ? 'Manual only'
        : 'Paper / halted';
  const cancelDisabledReason = !keysPresent
    ? 'Cancel is locked until server-side Binance keys are configured'
    : openOrders.length
      ? ''
      : 'No open orders to cancel';
  const orderDataTruth = keysPresent
    ? state?.binance.connected
      ? 'Account stream or polling is connected; rows are server snapshots.'
      : 'Keys exist, but account sync needs attention before rows are fresh.'
    : 'Paper mode shows no simulated orders; configure server keys to unlock account data.';

  const statuses = useMemo(() => {
    const s = Array.from(new Set(currentOrders.map((o) => o.status).filter(Boolean))).sort();
    return ['ALL', ...s];
  }, [currentOrders]);

  const queryText = query.trim().toUpperCase();
  const filtered = useMemo(() => {
    return currentOrders.filter((o) => {
      if (side !== 'ALL' && o.side !== side) return false;
      if (status !== 'ALL' && o.status !== status) return false;
      if (!queryText) return true;
      return (
        o.symbol.includes(queryText) ||
        baseOf(o.symbol).includes(queryText) ||
        String(o.orderId).includes(queryText) ||
        String(o.clientOrderId ?? '').toUpperCase().includes(queryText)
      );
    });
  }, [currentOrders, queryText, side, status]);

  const selected = filtered.find((o) => orderKey(o) === selectedKey) ?? filtered[0] ?? currentOrders[0] ?? null;
  const openNotional = openOrders.reduce((acc, o) => acc + orderNotional(o), 0);
  const staleOpen = openOrders.filter((o) => o.stale).length;
  const partialOpen = openOrders.filter((o) => o.status === 'PARTIALLY_FILLED').length;
  const workingKnown = allKnownOrders.filter((o) => isWorkingStatus(o.status)).length;
  const terminalKnown = allKnownOrders.filter((o) => !isWorkingStatus(o.status)).length;
  const filledHistory = histOrders.filter((o) => o.status === 'FILLED').length;
  const cancelableSymbols = Array.from(new Set(openOrders.map((o) => o.symbol))).sort();
  const buyCount = currentOrders.filter((o) => o.side === 'BUY').length;
  const sellCount = currentOrders.filter((o) => o.side === 'SELL').length;
  const latestTs = currentOrders[0]?.time ?? null;
  const syncTone = state?.binance.connected ? 'ok' : keysPresent ? 'warn' : 'idle';
  const manualTone = state?.config.killSwitch ? 'warn' : 'ok';
  const historyTone = hist ? 'ok' : keysPresent ? 'warn' : 'idle';
  const cancelTone = openOrders[0] ? (staleOpen ? 'bad' : 'warn') : 'ok';

  useEffect(() => {
    if (!selectedKey && currentOrders.length > 0) setSelectedKey(orderKey(currentOrders[0]));
  }, [currentOrders, selectedKey]);

  const loadHistory = async () => {
    if (historyDisabledReason) return;
    setLoadingHist(true);
    setHistErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/orders/history?symbol=${symbol}`);
      const d = (await res.json()) as { available: boolean; error?: string; orders: HistOrder[] };
      if (!d.available) setHistErr(d.error ?? 'Binance history unavailable');
      setHist(d.orders ?? []);
      setTab('history');
      setSelectedKey(d.orders?.[0] ? orderKey({ ...d.orders[0], origin: 'history' }) : null);
    } catch {
      setHistErr('Network error while loading Binance order history');
      setHist([]);
    } finally {
      setLoadingHist(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setSide('ALL');
    setStatus('ALL');
  };

  return (
    <div className="container page orders-page">
      <section className="orders-desk card">
        <div className="orders-desk-main">
          <div className="orders-desk-copy">
            <span className="orders-eyebrow"><IconTicket size={15} /> execution control</span>
            <h1 className="page-title">Order desk</h1>
            <p>
              Working orders, cancel readiness, held notional, and loaded Binance history stay in one operational view.
              Nothing here signs from the browser; every live action remains server-side, risk-gated, and ledgered.
            </p>
          </div>
          <div className="orders-desk-hold">
            <StatePill tone={keysPresent ? 'ok' : 'idle'}>{keysPresent ? 'Binance keys present' : 'keys absent'}</StatePill>
            <span>Held by open orders</span>
            <b className="num">{fmtMoney(openNotional)}</b>
            <em>{openOrders.length} working · {partialOpen} partial · {staleOpen} stale</em>
            <OrderBars orders={allKnownOrders} />
          </div>
        </div>

        <div className="orders-desk-stats">
          <OrderDeskStat label="Open limit" value={`${openOrders.length} / ${state?.config.maxOpenOrders ?? '—'}`} sub={latestTs ? `latest ${timeAgo(latestTs)}` : 'waiting for account sync'} tone={openOrders.length ? 'warn' : 'idle'} />
          <OrderDeskStat label="Flow sample" value={`${buyCount} buy / ${sellCount} sell`} sub={tab === 'open' ? 'working orders only' : 'loaded history sample'} tone={buyCount || sellCount ? 'ok' : 'idle'} />
          <OrderDeskStat label="History" value={hist ? hist.length.toLocaleString('en-US') : '—'} sub={hist ? `${filledHistory} filled · ${symbol}` : 'per-symbol last 100'} tone={historyTone} />
          <OrderDeskStat label="Known states" value={`${workingKnown} / ${terminalKnown}`} sub="working / terminal" tone={workingKnown ? 'warn' : terminalKnown ? 'ok' : 'idle'} />
        </div>

        <div className="orders-command-row">
          <button
            className={`orders-command-card ${syncTone}`}
            type="button"
            onClick={() => setPage(state?.binance.connected ? 'system' : 'account')}
          >
            <span className="orders-command-icon"><IconPulse size={15} /></span>
            <span className="orders-command-copy">
              <span>Account feed</span>
              <b>{state?.binance.connected ? 'Live sync' : keysPresent ? 'Needs attention' : 'Keys absent'}</b>
              <em>
                {state?.binance.connected
                  ? `Open orders refresh from Binance; latest state ${timeAgo(state?.binance.lastSyncTs ?? null)}.`
                  : keysPresent
                    ? state?.binance.lastError ?? 'Keys exist but account polling is not healthy.'
                    : 'Configure read-only server keys before orders, fills, and balances populate.'}
              </em>
            </span>
            <span className="orders-command-action">{state?.binance.connected ? 'System health' : 'Account setup'}</span>
          </button>
          <button
            className={`orders-command-card ${manualTone}`}
            type="button"
            onClick={() => setPage(state?.config.killSwitch ? 'risk' : 'trade')}
          >
            <span className="orders-command-icon"><IconShield size={15} /></span>
            <span className="orders-command-copy">
              <span>Manual order path</span>
              <b>{state?.config.killSwitch ? 'Halted' : 'Risk-gated'}</b>
              <em>
                {state?.config.killSwitch
                  ? 'Live sends are blocked. Keep this on until you intentionally arm manual mode.'
                  : `Ticket can be prepared; every send still obeys the ${fmtMoney(state?.config.maxOrderNotionalUsd ?? 0)} risk cap.`}
              </em>
            </span>
            <span className="orders-command-action">{state?.config.killSwitch ? 'Risk gate' : 'Manual trade'}</span>
          </button>
          <button
            className={`orders-command-card ${historyTone}`}
            type="button"
            onClick={() => {
              if (!keysPresent) setPage('account');
              else void loadHistory();
            }}
            title={historyDisabledReason || `Load ${symbol} order history`}
          >
            <span className="orders-command-icon"><IconRefresh size={15} /></span>
            <span className="orders-command-copy">
              <span>History request</span>
              <b>{hist ? `${hist.length} loaded` : keysPresent ? symbol : 'Locked'}</b>
              <em>{historyDisabledReason || `Request the last 100 Binance orders for ${symbol} and switch to history view.`}</em>
            </span>
            <span className="orders-command-action">{keysPresent ? (loadingHist ? 'Loading' : 'Load history') : 'Account setup'}</span>
          </button>
          <button
            className={`orders-command-card ${cancelTone}`}
            type="button"
            onClick={() => {
              const first = openOrders[0];
              if (first) {
                setTab('open');
                setStatus('ALL');
                setSelectedKey(orderKey(first));
              } else {
                setPage('ledger');
              }
            }}
          >
            <span className="orders-command-icon"><IconAlert size={15} /></span>
            <span className="orders-command-copy">
              <span>Cancel review</span>
              <b>{openOrders[0] ? `${openOrders.length} open` : 'Clear'}</b>
              <em>
                {openOrders[0]
                  ? `${openOrders[0].symbol} is ready for inspection; cancel actions stay server-side and ledgered.`
                  : 'No open orders are exposed in current state, so there is nothing to cancel.'}
              </em>
            </span>
            <span className="orders-command-action">{openOrders[0] ? 'Inspect open' : 'Open ledger'}</span>
          </button>
        </div>
      </section>

      <section className="orders-tools card">
        <div className="orders-tabbar">
          <button type="button" className={tab === 'open' ? 'on' : ''} onClick={() => {
            setTab('open');
            setStatus('ALL');
          }}>
            <span>Open</span>
            <b className="num">{openOrders.length}</b>
          </button>
          <button type="button" className={tab === 'history' ? 'on' : ''} onClick={() => {
            setTab('history');
            setStatus('ALL');
          }}>
            <span>History</span>
            <b className="num">{hist?.length ?? '—'}</b>
          </button>
        </div>
        <div className="orders-filter-row">
          <label className="orders-search">
            <IconSearch size={14} />
            <input placeholder="Search symbol, order id, client id" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
          </label>
          <div className="seg orders-seg">
            {(['ALL', 'BUY', 'SELL'] as SideFilter[]).map((s) => (
              <button key={s} type="button" className={side === s ? `on ${s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : ''}` : ''} onClick={() => setSide(s)}>
                {s === 'ALL' ? 'All sides' : s}
              </button>
            ))}
          </div>
          <div className="seg orders-seg status">
            {statuses.map((s) => (
              <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'All status' : s}
              </button>
            ))}
          </div>
          <button className="mini-btn" type="button" disabled={!query && side === 'ALL' && status === 'ALL'} onClick={clearFilters}>
            Clear
          </button>
        </div>
        <div className="orders-history-loader">
          <div>
            <b>{historyDisabledReason ? 'History locked' : 'Load Binance order history'}</b>
            <span>{historyDisabledReason || 'Binance serves order history per symbol; this requests the last 100 orders.'}</span>
          </div>
          <label className="orders-symbol-input">
            <span>Symbol</span>
            <input
              value={histSymbol}
              onChange={(e) => setHistSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadHistory();
              }}
              spellCheck={false}
            />
          </label>
          <button className="cta-pill" type="button" disabled={!!historyDisabledReason || loadingHist} title={historyDisabledReason || `Load ${symbol} order history`} onClick={() => void loadHistory()}>
            <IconRefresh size={14} />
            {loadingHist ? 'Loading' : historyDisabledReason ? 'Keys required' : 'Load history'}
          </button>
        </div>
        <div className="orders-readiness-strip">
          <div>
            <span>Mode</span>
            <b>{modeLabel}</b>
            <small>{orderDataTruth}</small>
          </div>
          <div>
            <span>Cancel capability</span>
            <b>{cancelDisabledReason ? 'Locked' : 'Server action ready'}</b>
            <small>{cancelDisabledReason || `${cancelableSymbols.length} open symbol${cancelableSymbols.length === 1 ? '' : 's'} can be reviewed.`}</small>
          </div>
          <div>
            <span>History source</span>
            <b>{hist ? `${hist.length} cached` : historyDisabledReason ? 'Not loaded' : 'Ready to request'}</b>
            <small>{hist ? `Current symbol ${symbol}; loaded rows stay searchable here.` : historyDisabledReason || 'Rows are requested per symbol from the server.'}</small>
          </div>
        </div>
        {histErr && <div className="result-strip bad">{histErr}</div>}
        {msg && <div className={`result-strip ${msg.tone}`}>{msg.text}</div>}
      </section>

      <div className="orders-layout">
        <main className="orders-main card">
          <div className="orders-table-head">
            <div>
              <h2>{tab === 'open' ? 'Open order blotter' : 'Binance order history'}</h2>
              <span>{filtered.length} shown from {currentOrders.length} {tab === 'open' ? 'open orders' : 'loaded orders'}</span>
            </div>
            <StatePill tone={filtered.length ? 'ok' : currentOrders.length ? 'warn' : 'idle'}>
              {filtered.length ? tab : currentOrders.length ? 'no match' : 'empty'}
            </StatePill>
          </div>

          {currentOrders.length === 0 ? (
            <div className="orders-empty">
              <EmptyState title={tab === 'open' ? 'No open orders' : hist === null ? 'Load a symbol history' : `No orders for ${symbol}`}>
                {tab === 'open'
                  ? keysPresent
                    ? 'Live orders will appear here from the user stream or polling sync. Manual trade tickets stay gated by risk before they become orders.'
                    : 'Configure server-side Binance keys to see and manage open orders. The UI is ready, but the account is intentionally disconnected.'
                  : keysPresent
                    ? 'Pick a symbol and load its Binance order history. Filled, canceled, rejected, and expired rows will render here.'
                    : 'Order history is locked until Binance keys exist on the server. No frontend key input is provided by design.'}
              </EmptyState>
              <div className="orders-empty-steps">
                <div><i>1</i><b>Manual trade creates intent</b><span>risk gate validates before any live send</span></div>
                <div><i>2</i><b>Binance sync updates state</b><span>open orders stream or poll into this blotter</span></div>
                <div><i>3</i><b>History audits outcomes</b><span>per-symbol orders and ledger events stay searchable</span></div>
              </div>
              <p className="orders-empty-foot">{orderDataTruth}</p>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No orders match these filters">Clear filters or search a different symbol, order id, or client id.</EmptyState>
          ) : (
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th className="l">Order</th>
                    <th className="l">Side</th>
                    <th className="l">Type</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Filled</th>
                    <th>Remaining</th>
                    <th>Notional</th>
                    <th className="l">Status</th>
                    <th className="l">Time</th>
                    {tab === 'open' && <th className="l">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const pct = fillPct(o);
                    const active = selected && orderKey(selected) === orderKey(o);
                    return (
                      <tr key={orderKey(o)} className={active ? 'selected' : ''} onClick={() => setSelectedKey(orderKey(o))}>
                        <td className="l">
                          <span className="orders-token-cell">
                            <TokenIcon symbol={o.symbol} size={32} />
                            <span>
                              <b>{o.symbol}</b>
                              <em>{String(o.clientOrderId ?? `#${o.orderId}`).slice(0, 18)}</em>
                            </span>
                          </span>
                        </td>
                        <td className="l"><SideTag side={o.side} /></td>
                        <td className="l muted">{o.type}</td>
                        <td className="num">{fmtPrice(num(o.price))}</td>
                        <td className="num">{fmtQty(num(o.origQty))}</td>
                        <td>
                          <span className="orders-fill-cell">
                            <b className="num">{fmtQty(num(o.executedQty))}</b>
                            <i><span style={{ width: `${pct}%` }} /></i>
                          </span>
                        </td>
                        <td className="num">{fmtQty(remainingQty(o))}</td>
                        <td className="num order-notional">{fmtMoney(orderNotional(o))}</td>
                        <td className="l"><span className={`chip-tag ${statusTone(o.status)}`}>{o.status}</span></td>
                        <td className="l muted" title={fmtDateTime(o.time)}>
                          {timeAgo(o.time)} {'stale' in o && o.stale && <span className="chip-tag gold">stale</span>}
                        </td>
                        {tab === 'open' && (
                          <td className="l">
                            <button
                              className="mini-btn"
                              type="button"
                              disabled={!keysPresent}
                              title={keysPresent ? `Cancel ${o.symbol} order ${o.orderId}` : 'Cancel locked: server-side Binance keys are not configured'}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!keysPresent) return;
                                const res = await cancelOrder(o.symbol, o.orderId);
                                setMsg(res.ok ? { tone: 'ok', text: `Cancel requested for ${o.symbol} order ${o.orderId}` } : { tone: 'bad', text: res.error ?? 'Cancel failed' });
                              }}
                            >
                              {keysPresent ? 'Cancel' : 'Keys required'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="orders-rail">
          <section className="orders-inspector card">
            <div className="orders-rail-head">
              <h2>Order inspector</h2>
              <span>{selected ? selected.origin : 'no order selected'}</span>
            </div>
            {selected ? (
              <>
                <div className="orders-selected-token">
                  <TokenIcon symbol={selected.symbol} size={42} />
                  <span>
                    <b>{baseOf(selected.symbol)}</b>
                    <em>{selected.symbol}</em>
                  </span>
                  <SideTag side={selected.side} />
                </div>
                <div className="orders-inspector-grid">
                  <span><em>Status</em><b>{selected.status}</b></span>
                  <span><em>Type</em><b>{selected.type}</b></span>
                  <span><em>Price</em><b className="num">{fmtPrice(num(selected.price))}</b></span>
                  <span><em>Notional</em><b className="num">{fmtMoney(orderNotional(selected))}</b></span>
                  <span><em>Original qty</em><b className="num">{fmtQty(num(selected.origQty))}</b></span>
                  <span><em>Executed qty</em><b className="num">{fmtQty(num(selected.executedQty))}</b></span>
                  <span><em>Order id</em><b className="num">{selected.orderId}</b></span>
                  <span><em>Time</em><b>{fmtDateTime(selected.time)}</b></span>
                </div>
                <div className="orders-progress-panel">
                  <span>
                    <b className="num">{fillPct(selected).toFixed(0)}%</b>
                    <em>filled</em>
                  </span>
                  <i><span style={{ width: `${fillPct(selected)}%` }} /></i>
                  <small>{fmtQty(remainingQty(selected))} remaining · {isWorkingStatus(selected.status) ? 'actionable while open' : 'terminal outcome'}</small>
                </div>
                <div className="orders-inspector-actions">
                  <button className="cta-pill" type="button" onClick={() => openDetail(selected.symbol)}>Open market</button>
                  <button className="mini-btn" type="button" onClick={() => openLedger(selected.symbol)}>Ledger</button>
                  {selected.origin === 'open' && (
                    <button
                      className="mini-btn danger"
                      type="button"
                      disabled={!keysPresent}
                      title={keysPresent ? `Cancel all open ${selected.symbol} orders` : 'Cancel-all locked: server-side Binance keys are not configured'}
                      onClick={async () => {
                        if (!keysPresent) return;
                        const res = await cancelAll(selected.symbol);
                        setMsg(res.ok ? { tone: 'ok', text: `Cancel-all requested for ${selected.symbol}` } : { tone: 'bad', text: res.error ?? 'Cancel-all failed' });
                      }}
                    >
                      {keysPresent ? 'Cancel all' : 'Keys required'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <EmptyState title="No order selected">Select a row to inspect fill progress, status, order id, and ledger trail.</EmptyState>
            )}
          </section>

          <section className="orders-inspector card">
            <div className="orders-rail-head">
              <h2>Order sources</h2>
              <span>what is live now</span>
            </div>
            <div className="orders-source-list">
              <button type="button" onClick={() => {
                setTab('open');
                setStatus('ALL');
              }}>
                <span><IconPulse size={15} /> Open orders</span>
                <b className="num">{openOrders.length}</b>
              </button>
              <button type="button" onClick={() => {
                setTab('history');
                setStatus('ALL');
              }}>
                <span><IconClock size={15} /> History cache</span>
                <b className="num">{hist?.length ?? 0}</b>
              </button>
              <button type="button" onClick={() => setPage('ledger')}>
                <span><IconBook size={15} /> Ledger events</span>
                <b>view</b>
              </button>
              <button type="button" onClick={() => setPage('system')}>
                <span><IconChart size={15} /> Sync health</span>
                <b>open</b>
              </button>
            </div>
          </section>
        </aside>
      </div>
      <p className="orders-source-note">Source: server-side Binance order snapshots, user-stream/polling cache, and the local audit ledger.</p>
    </div>
  );
}
