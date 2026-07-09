import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { Dot, Empty, Pill, Seg } from '../components/px';
import { PillSelect } from '../components/PillSelect';
import { TokenIcon } from '../components/TokenIcon';
import { IconRefresh } from '../components/Icons';
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

function isStale(order: AnyOrder): boolean {
  return 'stale' in order && Boolean((order as OpenOrderRow).stale);
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

export function Orders() {
  const { state, cancelOrder, cancelAll, openLedger, openDetail } = useStore();
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
  const keysPresent = !!state?.binance.keysPresent;
  const symbol = histSymbol.trim().toUpperCase();
  const symbolValid = /^[A-Z0-9]{5,20}$/.test(symbol);
  const historyDisabledReason = !keysPresent
    ? 'Server-side Binance keys are not configured'
    : !symbolValid
      ? 'Enter a Binance symbol such as BTCUSDT'
      : '';

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
  const staleOpen = openOrders.filter(isStale).length;

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

  return (
    <>
      <div className="lg-filters">
        <Seg
          value={tab}
          options={[
            { id: 'open', label: `Open · ${openOrders.length}` },
            { id: 'history', label: hist ? `History · ${hist.length}` : 'History' },
          ]}
          onChange={(t) => {
            setTab(t);
            setStatus('ALL');
          }}
        />
        <input
          className="hp-input lg-search"
          placeholder="Search symbol, order id, client id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <Seg
          value={side}
          options={[
            { id: 'ALL', label: 'All' },
            { id: 'BUY', label: 'Buy' },
            { id: 'SELL', label: 'Sell' },
          ]}
          onChange={setSide}
        />
        <PillSelect
          className="lg-select"
          value={status}
          options={statuses.map((s) => ({ id: s, label: s === 'ALL' ? 'All status' : s }))}
          onChange={setStatus}
          ariaLabel="Order Status Filter"
          testId="orders-status-filter"
        />
        <span className="lg-filter-gap" />
        <input
          className="hp-input lg-symbol"
          value={histSymbol}
          onChange={(e) => setHistSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void loadHistory();
          }}
          spellCheck={false}
          placeholder="BTCUSDT"
        />
        <button
          className="hp-btn"
          type="button"
          disabled={!!historyDisabledReason || loadingHist}
          title={historyDisabledReason || `Request the last 100 Binance orders for ${symbol}`}
          onClick={() => void loadHistory()}
        >
          <IconRefresh size={13} />
          {loadingHist ? 'Loading…' : 'Load history'}
        </button>
      </div>

      {histErr && <div className="hp-alert" style={{ marginBottom: 12 }}>{histErr}</div>}
      {msg && msg.tone === 'bad' && <div className="hp-alert" style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className={`lg-grid exec-grid ${selected ? '' : 'solo'}`}>
        <section className="hp-group lg-feed" aria-label="Order blotter">
          <div className="lg-feed-head">
            <h3>{tab === 'open' ? 'Open orders' : `Order history · ${symbol}`}</h3>
            <span className="hp-val">
              {tab === 'open' ? (
                <>
                  <Dot tone={openOrders.length ? 'warn' : 'ok'} />
                  {openOrders.length}/{state?.config.maxOpenOrders ?? '—'} open · {fmtMoney(openNotional)} held{staleOpen ? ` · ${staleOpen} stale` : ''}
                </>
              ) : (
                <>{filtered.length} of {currentOrders.length} rows</>
              )}
            </span>
          </div>
          {currentOrders.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title={tab === 'open' ? 'No open orders' : hist === null ? 'No history loaded' : `No orders for ${symbol}`}>
                {tab === 'open'
                  ? keysPresent
                    ? 'Live orders appear here from account sync. Tickets stay gated by risk before they become orders.'
                    : 'Configure server-side Binance keys to see open orders. No frontend key input exists by design.'
                  : keysPresent
                    ? 'Pick a symbol and load its last 100 Binance orders.'
                    : 'History is locked until server-side Binance keys exist.'}
              </Empty>
            </div>
          ) : filtered.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No orders match these filters">Clear filters or search a different symbol or id.</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table exec-table">
                <colgroup>
                  <col style={{ width: 150 }} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 76 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 84 }} />
                  {tab === 'open' && <col style={{ width: 84 }} />}
                </colgroup>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Side</th>
                    <th className="num-r">Price</th>
                    <th className="num-r">Qty</th>
                    <th className="num-r">Filled</th>
                    <th className="num-r">Left</th>
                    <th className="num-r">Notional</th>
                    <th>Status</th>
                    <th>Time</th>
                    {tab === 'open' && <th />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const active = selected && orderKey(selected) === orderKey(o);
                    return (
                      <tr key={orderKey(o)} className={active ? 'selected' : ''} onClick={() => setSelectedKey(orderKey(o))}>
                        <td className="t-source">
                          <span className="exec-sym">
                            <TokenIcon symbol={o.symbol} size={16} />
                            {o.symbol}
                          </span>
                        </td>
                        <td><Pill tone={o.side === 'BUY' ? 'ok' : 'bad'}>{o.side === 'BUY' ? 'Buy' : 'Sell'}</Pill></td>
                        <td className="t-value num-r">{fmtPrice(num(o.price))}</td>
                        <td className="t-value num-r">{fmtQty(num(o.origQty))}</td>
                        <td className="t-value num-r">{fillPct(o).toFixed(0)}%</td>
                        <td className="t-value num-r">{fmtQty(remainingQty(o))}</td>
                        <td className="t-value num-r">{fmtMoney(orderNotional(o))}</td>
                        <td><Pill tone={statusTone(o.status)}>{o.status.replace(/_/g, ' ').toLowerCase()}</Pill></td>
                        <td className="t-layer" title={fmtDateTime(o.time)}>
                          {timeAgo(o.time)}{isStale(o) ? ' · stale' : ''}
                        </td>
                        {tab === 'open' && (
                          <td>
                            <button
                              className="hp-btn danger exec-cancel"
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
                              Cancel
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
        </section>

        {selected && <aside className="hp-group lg-inspect" aria-label="Order inspector">
          {selected ? (
            <>
              <div className="lg-inspect-head">
                <Pill tone={statusTone(selected.status)}>{selected.status.replace(/_/g, ' ').toLowerCase()}</Pill>
                <h3>
                  {baseOf(selected.symbol)} · {selected.side === 'BUY' ? 'Buy' : 'Sell'} {selected.type}
                </h3>
                <span>#{selected.orderId} · {selected.origin === 'open' ? 'open order' : 'history'}</span>
              </div>
              <dl className="lg-facts">
                <div><dt>Price</dt><dd className="num">{fmtPrice(num(selected.price))}</dd></div>
                <div><dt>Notional</dt><dd className="num">{fmtMoney(orderNotional(selected))}</dd></div>
                <div><dt>Quantity</dt><dd className="num">{fmtQty(num(selected.origQty))}</dd></div>
                <div><dt>Executed</dt><dd className="num">{fmtQty(num(selected.executedQty))} · {fillPct(selected).toFixed(0)}%</dd></div>
                <div><dt>Remaining</dt><dd className="num">{fmtQty(remainingQty(selected))}</dd></div>
                <div><dt>Time</dt><dd>{fmtDateTime(selected.time)}</dd></div>
                <div><dt>State</dt><dd>{isWorkingStatus(selected.status) ? 'working — actionable while open' : 'terminal outcome'}</dd></div>
              </dl>
              <div className="lg-related">
                <button className="hp-btn" type="button" onClick={() => openDetail(selected.symbol)}>Open market</button>
                <button className="hp-btn" type="button" onClick={() => openLedger(selected.symbol)}>Ledger trail</button>
                {selected.origin === 'open' && (
                  <button
                    className="hp-btn danger"
                    type="button"
                    disabled={!keysPresent}
                    title={keysPresent ? `Cancel all open ${selected.symbol} orders` : 'Cancel-all locked: server-side Binance keys are not configured'}
                    onClick={async () => {
                      if (!keysPresent) return;
                      const res = await cancelAll(selected.symbol);
                      setMsg(res.ok ? { tone: 'ok', text: `Cancel-all requested for ${selected.symbol}` } : { tone: 'bad', text: res.error ?? 'Cancel-all failed' });
                    }}
                  >
                    Cancel all {baseOf(selected.symbol)}
                  </button>
                )}
              </div>
            </>
          ) : null}
        </aside>}
      </div>
    </>
  );
}
