import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { SideTag, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { OrderBook } from '../components/OrderBook';
import { IconChart, IconShield, IconTicket, IconWallet } from '../components/Icons';
import { fmtPrice, fmtPct, signClass, baseOf } from '../format';
import type { PreviewResult, Quote, SendResult, Side, OrderType } from '../types';

export function ManualTrade() {
  const { state, ticket, clearTicket, preview, testOrder, sendLive, openDetail } = useStore();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<Side>('BUY');
  const [type, setType] = useState<OrderType>('LIMIT');
  const [qty, setQty] = useState('');
  const [quoteQty, setQuoteQty] = useState('');
  const [price, setPrice] = useState('');
  const [tif, setTif] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [source, setSource] = useState<'manual' | 'proposal'>('manual');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pv, setPv] = useState<PreviewResult | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    if (ticket.symbol) setSymbol(ticket.symbol);
    if (ticket.side) setSide(ticket.side);
    if (ticket.type) setType(ticket.type);
    if (ticket.price) setPrice(String(ticket.price));
    if (ticket.quantity) setQty(String(ticket.quantity));
    if (ticket.quoteQty) setQuoteQty(String(ticket.quoteQty));
    setSource(ticket.source ?? 'manual');
    setPv(null);
    setTestResult(null);
    setSendResult(null);
    clearTicket();
  }, [ticket, clearTicket]);

  useEffect(() => {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      setQuote(null);
      return;
    }
    let alive = true;
    const load = () =>
      fetch(`/api/market/quote?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((q) => alive && q && setQuote(q as Quote))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  const intent = () => ({
    symbol,
    side,
    type,
    quantity: qty ? Number(qty) : undefined,
    quoteQty: type === 'MARKET' && quoteQty ? Number(quoteQty) : undefined,
    price: type === 'LIMIT' && price ? Number(price) : undefined,
    timeInForce: type === 'LIMIT' ? tif : undefined,
    source,
  });

  const reset = () => {
    setQty('');
    setQuoteQty('');
    setPrice('');
    setTif('GTC');
    setPv(null);
    setTestResult(null);
    setSendResult(null);
    setSource('manual');
  };

  const doPreview = async () => {
    setBusy(true);
    setTestResult(null);
    setSendResult(null);
    setPv(await preview(intent()));
    setBusy(false);
  };

  const mode = state?.mode ?? 'HALTED';
  const keysPresent = state?.binance.keysPresent ?? false;
  const canShowLiveButton = mode === 'LIVE_ARMED' && keysPresent;
  const spread =
    quote?.book && quote.book.bidPrice > 0
      ? ((quote.book.askPrice - quote.book.bidPrice) / quote.book.bidPrice) * 100
      : null;
  const base = baseOf(symbol) || 'BASE';
  const draftPrice = type === 'LIMIT' && price ? Number(price) : quote?.last ?? null;
  const draftQty = qty ? Number(qty) : null;
  const draftQuoteQty = type === 'MARKET' && quoteQty ? Number(quoteQty) : null;
  const draftNotional =
    draftQuoteQty ?? (draftQty !== null && draftPrice !== null && isFinite(draftQty) && isFinite(draftPrice) ? draftQty * draftPrice : null);
  const liveTone = mode === 'LIVE_ARMED' ? 'ok' : mode === 'MANUAL' ? 'warn' : 'bad';
  const keysTone = keysPresent ? 'ok' : 'idle';
  const riskPassed = !!(pv?.ok && pv.risk.allowed);
  const liveHint = canShowLiveButton
    ? riskPassed
      ? 'Passing preview can open the typed live-confirmation modal.'
      : 'Run a passing preview with every risk check allowed before live send becomes available.'
    : `Live send hidden: mode ${mode}${!keysPresent ? ', no keys' : ''}.`;
  const symbolValid = /^[A-Z0-9]{5,20}$/.test(symbol);
  const maxPerOrder = state?.config.maxOrderNotionalUsd ?? null;

  // Quick sizing (UI convenience only — filters and the risk gate still rule):
  // MARKET sizes by quote amount directly, LIMIT computes qty at the draft price.
  const applyQuickSize = (usd: number) => {
    if (type === 'MARKET') {
      setQuoteQty(String(usd));
      setQty('');
      return;
    }
    const p = draftPrice;
    if (!p || !isFinite(p) || p <= 0) return;
    const q = usd / p;
    setQty(q >= 1 ? String(Number(q.toFixed(4))) : q.toPrecision(5).replace(/0+$/, ''));
  };

  // Clicking a book price loads it straight into the limit ticket.
  const useBookPrice = (p: number) => {
    setType('LIMIT');
    setPrice(String(p));
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Manual Trade</h1>
          <div className="page-sub">
            Preview → validate → send. Every send passes the server-side risk gate and a typed confirmation.
          </div>
        </div>
        {source === 'proposal' && <span className="chip-tag gold">prefilled from proposal</span>}
      </div>

      <div className="trade-layout">
        <main className="trade-main">
          <section className="card trade-ticket" data-side={side}>
            <div className="trade-card-head">
              <div className="trade-identity">
                <TokenIcon symbol={symbol} size={44} />
                <div>
                  <div className="trade-symbol">{symbol || '—'}</div>
                  <div className="trade-sub">
                    {base}/USDT spot ticket · {source === 'proposal' ? 'proposal prefill' : 'manual source'}
                  </div>
                </div>
              </div>
              <div className="trade-state-stack">
                <StatePill tone={liveTone}>{mode === 'LIVE_ARMED' ? 'Live armed' : mode.toLowerCase()}</StatePill>
                <StatePill tone={keysTone}>{keysPresent ? 'Keys present' : 'No keys'}</StatePill>
              </div>
            </div>

            <div className="trade-draft-grid">
              <div>
                <span className="k">Draft side</span>
                <span className={`v ${side === 'BUY' ? 'up' : 'down'}`}>{side}</span>
              </div>
              <div>
                <span className="k">Reference price</span>
                <span className="v num">{fmtPrice(draftPrice)}</span>
              </div>
              <div>
                <span className="k">Draft notional</span>
                <span className="v num">{fmtPrice(draftNotional)}</span>
              </div>
            </div>

            <div className="side-toggle">
              <button className={`buy ${side === 'BUY' ? 'on' : ''}`} onClick={() => setSide('BUY')}>
                Buy {base}
              </button>
              <button className={`sell ${side === 'SELL' ? 'on' : ''}`} onClick={() => setSide('SELL')}>
                Sell {base}
              </button>
            </div>

            <div className="trade-input-grid">
              <div className="fld trade-symbol-field">
                <span>Symbol</span>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} spellCheck={false} />
              </div>

              <div className="trade-control-block">
                <span className="trade-field-label">Order type</span>
                <div className="seg">
                  {(['LIMIT', 'MARKET'] as OrderType[]).map((t) => (
                    <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                      {t === 'LIMIT' ? 'Limit' : 'Market'}
                    </button>
                  ))}
                </div>
              </div>

              {type === 'LIMIT' && (
                <div className="fld">
                  <span>Limit price (USDT)</span>
                  <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={quote?.last ? String(quote.last) : '0.00'} />
                </div>
              )}

              <div className="fld">
                <span>Quantity ({base})</span>
                <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.0" />
                <div className="qsize-row">
                  {[5, 10].map((usd) => (
                    <button
                      key={usd}
                      className="qsize-chip"
                      title={type === 'MARKET' ? `Set quote amount to $${usd}` : `Size ~$${usd} at the draft price`}
                      onClick={() => applyQuickSize(usd)}
                    >
                      ${usd}
                    </button>
                  ))}
                  {maxPerOrder !== null && (
                    <button
                      className="qsize-chip max"
                      title={`Your per-order risk cap: $${maxPerOrder}`}
                      onClick={() => applyQuickSize(maxPerOrder)}
                    >
                      Max ${maxPerOrder}
                    </button>
                  )}
                </div>
              </div>

              {type === 'MARKET' && (
                <div className="fld">
                  <span>Quote amount (USDT)</span>
                  <input type="number" value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} placeholder="e.g. 10" />
                </div>
              )}

              {type === 'LIMIT' && (
                <div className="trade-control-block">
                  <span className="trade-field-label">Time in force</span>
                  <span className="seg">
                    {(['GTC', 'IOC', 'FOK'] as const).map((t) => (
                      <button key={t} className={tif === t ? 'on' : ''} onClick={() => setTif(t)} title={t === 'GTC' ? 'Good till canceled' : t === 'IOC' ? 'Immediate or cancel' : 'Fill or kill'}>
                        {t}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>

            <div className="ticket-actions">
              <button className="cta-pill" disabled={busy} onClick={doPreview}>
                <IconTicket size={15} />
                Preview
              </button>
              <button className="mini-btn" disabled={busy} onClick={reset} title="Clear the ticket">
                Reset
              </button>
              <button
                className="mini-btn"
                disabled={busy || !keysPresent}
                title={keysPresent ? 'Signed validation against Binance — nothing is placed' : 'Needs Binance keys'}
                onClick={async () => {
                  setBusy(true);
                  setTestResult(await testOrder(intent()));
                  setBusy(false);
                }}
              >
                Validate
              </button>
              {canShowLiveButton ? (
                <button
                  className="cta-pill danger"
                  disabled={busy || !riskPassed}
                  title={riskPassed ? 'Opens the live confirmation' : 'Run a passing preview with every risk check allowed first'}
                  onClick={() => setShowConfirm(true)}
                >
                  Send live…
                </button>
              ) : (
                <span className="trade-live-note">{liveHint}</span>
              )}
            </div>
            {canShowLiveButton && <div className="trade-live-note trade-live-note-row">{liveHint}</div>}

            {testResult && (
              <div className={`result-strip ${testResult.ok ? 'ok' : 'bad'}`}>
                {testResult.ok
                  ? 'Binance validated this order (signed test — nothing placed).'
                  : `Validation failed: ${testResult.error}`}
              </div>
            )}
            {sendResult && (
              <div className={`result-strip ${sendResult.sent ? 'ok' : 'bad'}`}>
                {sendResult.sent
                  ? `LIVE ORDER PLACED — id ${sendResult.order?.orderId}, status ${sendResult.order?.status}, executed ${sendResult.order?.executedQty}`
                  : `Not sent: ${sendResult.error ?? sendResult.risk?.reasons.join(' · ') ?? 'rejected'}`}
              </div>
            )}
          </section>

          <section className="card risk-panel">
            <div className="trade-card-head compact">
              <div className="trade-identity">
                <span className={`trade-icon ${riskPassed ? 'ok' : pv ? 'bad' : ''}`}>
                  <IconShield size={18} />
                </span>
                <div>
                  <div className="trade-panel-title">Risk gate</div>
                  <div className="trade-sub">Preview now, re-check server-side at live send.</div>
                </div>
              </div>
              <StatePill tone={riskPassed ? 'ok' : pv ? 'bad' : 'idle'}>{pv ? (riskPassed ? 'Passing' : 'Blocked') : 'Awaiting preview'}</StatePill>
            </div>

            {!pv ? (
              <div className="trade-await">
                <IconTicket size={20} />
                <div>
                  <b>Build the ticket, then preview.</b>
                  <span>The preview records an intent, applies filters, estimates notional, and shows every gate before live send is even possible.</span>
                </div>
              </div>
            ) : (
              <>
                {pv.errors.length > 0 && <div className="result-strip bad">{pv.errors.join(' · ')}</div>}
                <div className="trade-preview-strip">
                  <div>
                    <span className="k">Order</span>
                    <span className="v">
                      <SideTag side={pv.side} /> {pv.quoteQty ? pv.quoteQty : pv.quantity ?? '—'}
                      {pv.quoteQty ? ' USDT by quote' : ` ${baseOf(pv.symbol)}`} @{' '}
                      {pv.type === 'LIMIT' ? fmtPrice(pv.effectivePrice) : 'market'}
                    </span>
                  </div>
                  <div>
                    <span className="k">Est. notional</span>
                    <span className="v num">{fmtPrice(pv.estNotionalUsd)}</span>
                  </div>
                  <div>
                    <span className="k">Filters</span>
                    <span className="v num">
                      {pv.filters ? `step ${pv.filters.stepSize} · min ${pv.filters.minQty} · $${pv.filters.minNotional}` : '—'}
                    </span>
                  </div>
                </div>
                <div className="trade-gate-list">
                  {pv.risk.checks.map((c) => (
                    <div key={c.name} className={`trade-gate-row ${c.pass ? 'pass' : 'fail'}`}>
                      <span className="gate-mark">{c.pass ? '✓' : '✕'}</span>
                      <span className="gate-main">
                        <span className="gate-name">{c.name}</span>
                        <span className="gate-detail">{c.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </main>

        <aside className="trade-rail">
          <section className="card trade-quote-card">
            <div className="rail-head">
              <span className="rail-title">
                <span className="tok" style={{ gap: 8 }}>
                  <TokenIcon symbol={symbol} size={24} />
                  {symbol || '—'}
                </span>
              </span>
              <button className="sec-link" onClick={() => openDetail(symbol)}>
                Full page →
              </button>
            </div>
            <div className="trade-price-line">
              <Num value={quote?.last ?? null} className="headline-val">
                <span>{fmtPrice(quote?.last)}</span>
              </Num>
              <span className={`hl-chip num ${signClass(quote?.change24hPct)}`}>{fmtPct(quote?.change24hPct, 2)}</span>
            </div>
            {quote && !quote.tradable && <div className="result-strip warn">Not a tradable spot symbol.</div>}
            <div className="quote-meta-row">
              <span className="k">Spread</span>
              <span className="v num">{spread !== null ? `${spread.toFixed(4)}%` : '—'}</span>
            </div>
          </section>

          {symbolValid && quote?.tradable !== false && (
            <>
              <OrderBook symbol={symbol} base={base} levels={7} onPriceClick={useBookPrice} />
              <div className="rail-hint">Click any book price to load it into the limit ticket.</div>
            </>
          )}

          <section className="card trade-account-card">
            <div className="trade-card-head compact">
              <div className="trade-identity">
                <span className="trade-icon">
                  <IconWallet size={18} />
                </span>
                <div>
                  <div className="trade-panel-title">Account guardrails</div>
                  <div className="trade-sub">Server values used by the gate.</div>
                </div>
              </div>
            </div>
            <div className="drow">
              <span className="k">Available USDT</span>
              <span className="v num">{fmtPrice(state?.account?.availableUsdt)}</span>
            </div>
            <div className="drow">
              <span className="k">Max per order</span>
              <span className="v num">{fmtPrice(state?.config.maxOrderNotionalUsd)}</span>
            </div>
            <div className="drow">
              <span className="k">Daily used</span>
              <span className="v num">
                {fmtPrice(state?.risk.dailyNotionalUsedUsd)} / {fmtPrice(state?.config.maxDailyNotionalUsd)}
              </span>
            </div>
            <div className="drow">
              <span className="k">Open orders</span>
              <span className="v num">
                {state?.openOrders.length ?? 0} / {state?.config.maxOpenOrders}
              </span>
            </div>
          </section>

          <section className="card trade-safety-card">
            <div className="trade-card-head compact">
              <div className="trade-identity">
                <span className="trade-icon">
                  <IconChart size={18} />
                </span>
                <div>
                  <div className="trade-panel-title">Execution discipline</div>
                  <div className="trade-sub">No path places an order from this screen without preview, confirmation, and server re-check.</div>
                </div>
              </div>
            </div>
            <div className="safety-row">
              <span>Typed confirmation</span>
              <b>{symbol}</b>
            </div>
            <div className="safety-row">
              <span>Kill switch</span>
              <StatePill tone={state?.config.killSwitch ? 'bad' : 'ok'}>{state?.config.killSwitch ? 'On' : 'Off'}</StatePill>
            </div>
            <div className="safety-row">
              <span>Live trading</span>
              <StatePill tone={state?.config.liveTradingEnabled ? 'ok' : 'warn'}>{state?.config.liveTradingEnabled ? 'Armed' : 'Manual only'}</StatePill>
            </div>
          </section>
        </aside>
      </div>

      {showConfirm && pv && (
        <ConfirmModal
          title="Place a REAL Binance order"
          requireText={symbol}
          confirmLabel="Send live order"
          danger
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            const res = await sendLive(intent(), symbol);
            setSendResult(res);
            setBusy(false);
            setShowConfirm(false);
          }}
          onClose={() => setShowConfirm(false)}
        >
          <div className="drow">
            <span className="k">Order</span>
            <span className="v">
              <SideTag side={side} /> <b>{symbol}</b> {type}
            </span>
          </div>
          <div className="drow">
            <span className="k">Size</span>
            <span className="v num">
              {qty || `${quoteQty} USDT by quote`} {type === 'LIMIT' && `@ ${fmtPrice(Number(price))}`}
            </span>
          </div>
          <div className="drow">
            <span className="k">Est. notional</span>
            <span className="v num">{fmtPrice(pv.estNotionalUsd)}</span>
          </div>
          <div className="drow">
            <span className="k">Available USDT</span>
            <span className="v num">{fmtPrice(state?.account?.availableUsdt)}</span>
          </div>
          <div className="result-strip bad" style={{ marginTop: 12 }}>
            This places a real order with real funds. The risk gate runs again server-side at send time.
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
