import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { SideTag } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
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

      <div className="two-col">
        <div>
          <div className="sec-head" style={{ marginTop: 10 }}>
            <h2 className="sec-title">Order ticket</h2>
            <span className="sec-note">mode: {mode === 'LIVE_ARMED' ? 'live armed' : mode.toLowerCase()}</span>
          </div>

          <div className="fld">
            <span>Symbol</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} spellCheck={false} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 13, flexWrap: 'wrap' }}>
            <div className="seg">
              <button className={side === 'BUY' ? 'on buy' : ''} onClick={() => setSide('BUY')}>
                Buy
              </button>
              <button className={side === 'SELL' ? 'on sell' : ''} onClick={() => setSide('SELL')}>
                Sell
              </button>
            </div>
            <div className="seg">
              {(['LIMIT', 'MARKET'] as OrderType[]).map((t) => (
                <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
                  {t === 'LIMIT' ? 'Limit' : 'Market'}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            {type === 'LIMIT' && (
              <div className="fld">
                <span>Limit price (USDT)</span>
                <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={quote?.last ? String(quote.last) : '0.00'} />
              </div>
            )}
            <div className="fld">
              <span>Quantity ({baseOf(symbol) || 'base'})</span>
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.0" />
            </div>
            {type === 'MARKET' && (
              <div className="fld">
                <span>…or quote (USDT)</span>
                <input type="number" value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} placeholder="e.g. 10" />
              </div>
            )}
          </div>

          {type === 'LIMIT' && (
            <div className="fld">
              <span>Time in force</span>
              <span className="seg" style={{ alignSelf: 'flex-start' }}>
                {(['GTC', 'IOC', 'FOK'] as const).map((t) => (
                  <button key={t} className={tif === t ? 'on' : ''} onClick={() => setTif(t)} title={t === 'GTC' ? 'Good till canceled' : t === 'IOC' ? 'Immediate or cancel' : 'Fill or kill'}>
                    {t}
                  </button>
                ))}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="cta-pill" disabled={busy} onClick={doPreview}>
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
                disabled={busy || !pv?.ok}
                title={pv?.ok ? 'Opens the live confirmation' : 'Run a passing preview first'}
                onClick={() => setShowConfirm(true)}
              >
                Send live…
              </button>
            ) : (
              <span className="muted small">
                Live send hidden — mode is <b>{mode}</b>
                {!keysPresent && ', no keys'}. Arm on the Risk page.
              </span>
            )}
          </div>

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

          {pv && (
            <>
              <div className="sec-head">
                <h2 className="sec-title">Risk gate</h2>
                <span className="sec-note">re-checked server-side at send time</span>
              </div>
              {pv.errors.length > 0 && <div className="result-strip bad">{pv.errors.join(' · ')}</div>}
              <div className="drow">
                <span className="k">Order</span>
                <span className="v">
                  <SideTag side={pv.side} /> {pv.quantity ?? pv.quoteQty ?? '—'}
                  {pv.quoteQty ? ' USDT by quote' : ` ${baseOf(pv.symbol)}`} @{' '}
                  {pv.type === 'LIMIT' ? fmtPrice(pv.effectivePrice) : 'market'}
                </span>
              </div>
              <div className="drow">
                <span className="k">Est. notional</span>
                <span className="v num">{fmtPrice(pv.estNotionalUsd)}</span>
              </div>
              {pv.filters && (
                <div className="drow">
                  <span className="k">Binance filters</span>
                  <span className="v muted small num">
                    step {pv.filters.stepSize} · minQty {pv.filters.minQty} · minNotional ${pv.filters.minNotional}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                {pv.risk.checks.map((c) => (
                  <div key={c.name} className={`risk-check ${c.pass ? 'pass' : 'fail'}`}>
                    <span className="risk-mark">{c.pass ? '✓' : '✗'}</span>
                    <span className="risk-name">{c.name}</span>
                    <span className="risk-detail">{c.detail}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rail">
          <div className="rail-sec">
            <div className="rail-head">
              <span className="rail-title">
                <span className="tok" style={{ gap: 8 }}>
                  <TokenIcon symbol={symbol} size={22} />
                  {symbol || '—'}
                </span>
              </span>
              <button className="sec-link" onClick={() => openDetail(symbol)}>
                Full page →
              </button>
            </div>
            <div className="headline" style={{ margin: '10px 0 6px' }}>
              <Num value={quote?.last ?? null} className="headline-val" >
                <span style={{ fontSize: 30 }}>{fmtPrice(quote?.last)}</span>
              </Num>
              <span className={`hl-chip num ${signClass(quote?.change24hPct)}`}>{fmtPct(quote?.change24hPct, 2)}</span>
            </div>
            {quote && !quote.tradable && <div className="result-strip warn">Not a tradable spot symbol.</div>}
            <div className="ladder-row">
              <span className="bar ask" style={{ width: '48%' }} />
              <span className="k">Ask</span>
              <span className="v num">{fmtPrice(quote?.book?.askPrice)}</span>
            </div>
            <div className="ladder-mid">spread {spread !== null ? `${spread.toFixed(4)}%` : '—'}</div>
            <div className="ladder-row">
              <span className="bar bid" style={{ width: '48%' }} />
              <span className="k">Bid</span>
              <span className="v num">{fmtPrice(quote?.book?.bidPrice)}</span>
            </div>
          </div>

          <div className="rail-sec">
            <div className="rail-head">
              <span className="rail-title">Account</span>
            </div>
            <div className="drow">
              <span className="k">Available USDT</span>
              <span className="v num">{fmtPrice(state?.account?.availableUsdt)}</span>
            </div>
            <div className="drow">
              <span className="k">Max per order</span>
              <span className="v num">${state?.config.maxOrderNotionalUsd}</span>
            </div>
            <div className="drow">
              <span className="k">Daily used</span>
              <span className="v num">
                {fmtPrice(state?.risk.dailyNotionalUsedUsd)} / ${state?.config.maxDailyNotionalUsd}
              </span>
            </div>
            <div className="drow">
              <span className="k">Open orders</span>
              <span className="v num">
                {state?.openOrders.length ?? 0} / {state?.config.maxOpenOrders}
              </span>
            </div>
          </div>
        </div>
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
