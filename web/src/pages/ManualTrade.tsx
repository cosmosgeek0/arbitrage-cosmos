import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { SideTag } from '../components/ui';
import { fmtPrice, fmtPct } from '../format';
import type { PreviewResult, Quote, SendResult, Side, OrderType } from '../types';

export function ManualTrade() {
  const { state, ticket, clearTicket, preview, testOrder, sendLive } = useStore();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<Side>('BUY');
  const [type, setType] = useState<OrderType>('LIMIT');
  const [qty, setQty] = useState('');
  const [quoteQty, setQuoteQty] = useState('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState<'manual' | 'proposal'>('manual');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pv, setPv] = useState<PreviewResult | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Apply a prefilled ticket (from proposals or the dashboard quick card).
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

  // Poll the live quote for the selected symbol.
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
    source,
  });

  const doPreview = async () => {
    setBusy(true);
    setTestResult(null);
    setSendResult(null);
    setPv(await preview(intent()));
    setBusy(false);
  };

  const doTest = async () => {
    setBusy(true);
    setTestResult(await testOrder(intent()));
    setBusy(false);
  };

  const doSend = async () => {
    setBusy(true);
    const res = await sendLive(intent(), symbol);
    setSendResult(res);
    setBusy(false);
    setShowConfirm(false);
  };

  const mode = state?.mode ?? 'HALTED';
  const keysPresent = state?.binance.keysPresent ?? false;
  const canShowLiveButton = mode === 'LIVE_ARMED' && keysPresent;
  const spread =
    quote?.book && quote.book.bidPrice > 0
      ? ((quote.book.askPrice - quote.book.bidPrice) / quote.book.bidPrice) * 100
      : null;

  return (
    <>
      <div className="trade-grid">
        <div className="card ticket-card">
          <div className="card-head">
            <b>Order ticket</b>
            {source === 'proposal' && <span className="chip chip-gold">from proposal</span>}
          </div>

          <label className="fld">
            <span>Symbol</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} spellCheck={false} />
          </label>

          <div className="side-toggle">
            <button className={`side-btn buy ${side === 'BUY' ? 'active' : ''}`} onClick={() => setSide('BUY')}>
              BUY
            </button>
            <button className={`side-btn sell ${side === 'SELL' ? 'active' : ''}`} onClick={() => setSide('SELL')}>
              SELL
            </button>
          </div>

          <div className="type-toggle">
            {(['LIMIT', 'MARKET'] as OrderType[]).map((t) => (
              <button key={t} className={`type-btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>

          {type === 'LIMIT' && (
            <label className="fld">
              <span>Limit price (USDT)</span>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </label>
          )}

          <label className="fld">
            <span>Quantity ({symbol.replace(/USDT$/, '') || 'base'})</span>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.0" />
          </label>

          {type === 'MARKET' && (
            <label className="fld">
              <span>…or quote amount (USDT)</span>
              <input
                type="number"
                value={quoteQty}
                onChange={(e) => setQuoteQty(e.target.value)}
                placeholder="e.g. 10"
              />
            </label>
          )}

          <div className="ticket-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={doPreview}>
              Preview
            </button>
            <button className="btn btn-ghost" disabled={busy || !keysPresent} onClick={doTest} title={keysPresent ? 'Signed validation against Binance (no order placed)' : 'Needs Binance keys'}>
              Validate
            </button>
            {canShowLiveButton ? (
              <button
                className="btn btn-red"
                disabled={busy || !pv?.ok}
                title={pv?.ok ? 'Opens the live confirmation' : 'Run a passing preview first'}
                onClick={() => setShowConfirm(true)}
              >
                Send live…
              </button>
            ) : (
              <span className="muted small live-note">
                Live send hidden — mode is <b>{mode}</b>
                {!keysPresent && ', no keys'}. Arm it on the Risk page.
              </span>
            )}
          </div>

          {testResult && (
            <div className={`result-banner ${testResult.ok ? 'ok' : 'bad'}`}>
              {testResult.ok ? 'Binance validated this order (signed test, nothing placed).' : `Validation failed: ${testResult.error}`}
            </div>
          )}
          {sendResult && (
            <div className={`result-banner ${sendResult.sent ? 'ok' : 'bad'}`}>
              {sendResult.sent
                ? `LIVE ORDER PLACED — id ${sendResult.order?.orderId}, status ${sendResult.order?.status}, executed ${sendResult.order?.executedQty}`
                : `Not sent: ${sendResult.error ?? sendResult.risk?.reasons.join(' · ') ?? 'rejected'}`}
            </div>
          )}
        </div>

        <div className="trade-side">
          <div className="card">
            <div className="card-head">
              <b>{symbol || '—'} market</b>
              {quote && !quote.tradable && <span className="chip">not a tradable spot symbol</span>}
            </div>
            <div className="quote-grid">
              <div>
                <div className="stat-label">Last</div>
                <div className="quote-big">{fmtPrice(quote?.last)}</div>
                <div className={quote?.change24hPct != null && quote.change24hPct >= 0 ? 'pos small' : 'neg small'}>
                  {fmtPct(quote?.change24hPct)} 24h
                </div>
              </div>
              <div>
                <div className="stat-label">Bid / Ask</div>
                <div className="num">
                  {fmtPrice(quote?.book?.bidPrice)} / {fmtPrice(quote?.book?.askPrice)}
                </div>
                <div className="muted small">spread {spread !== null ? `${spread.toFixed(4)}%` : '—'}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <b>Preview & risk gate</b>
            </div>
            {!pv ? (
              <div className="muted small">Run a preview — it validates against Binance filters and shows every risk check before anything is sent.</div>
            ) : (
              <>
                {pv.errors.length > 0 && (
                  <div className="result-banner bad">{pv.errors.join(' · ')}</div>
                )}
                <div className="pv-row">
                  <span className="muted">Order</span>
                  <span>
                    <SideTag side={pv.side} /> {pv.quantity ?? pv.quoteQty ?? '—'}
                    {pv.quoteQty ? ' USDT (by quote)' : ` ${pv.symbol.replace(/USDT$/, '')}`} @{' '}
                    {pv.type === 'LIMIT' ? fmtPrice(pv.effectivePrice) : 'market'}
                  </span>
                </div>
                <div className="pv-row">
                  <span className="muted">Est. notional</span>
                  <span className="num strong">{fmtPrice(pv.estNotionalUsd)}</span>
                </div>
                {pv.filters && (
                  <div className="pv-row">
                    <span className="muted">Binance filters</span>
                    <span className="small muted">
                      step {pv.filters.stepSize} · minQty {pv.filters.minQty} · minNotional ${pv.filters.minNotional}
                    </span>
                  </div>
                )}
                <div className="risk-checks">
                  {pv.risk.checks.map((c) => (
                    <div key={c.name} className={`risk-check ${c.pass ? 'pass' : 'fail'}`}>
                      <span className="risk-mark">{c.pass ? '✓' : '✗'}</span>
                      <span className="risk-name">{c.name}</span>
                      <span className="muted small">{c.detail}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
          onConfirm={() => void doSend()}
          onClose={() => setShowConfirm(false)}
        >
          <div className="confirm-grid">
            <div className="pv-row">
              <span className="muted">Order</span>
              <span>
                <SideTag side={side} /> <b>{symbol}</b> {type}
              </span>
            </div>
            <div className="pv-row">
              <span className="muted">Size</span>
              <span>
                {qty || `${quoteQty} USDT by quote`} {type === 'LIMIT' && `@ ${fmtPrice(Number(price))}`}
              </span>
            </div>
            <div className="pv-row">
              <span className="muted">Est. notional</span>
              <span className="strong">{fmtPrice(pv.estNotionalUsd)}</span>
            </div>
            <div className="pv-row">
              <span className="muted">Available USDT</span>
              <span>{fmtPrice(state?.account?.availableUsdt)}</span>
            </div>
            <div className="pv-row">
              <span className="muted">Limits</span>
              <span className="small muted">
                max/order ${state?.config.maxOrderNotionalUsd} · daily ${state?.risk.dailyNotionalUsedUsd.toFixed(2)}/
                {state?.config.maxDailyNotionalUsd} used
              </span>
            </div>
            <div className="result-banner bad" style={{ marginTop: 10 }}>
              This will place a real order on Binance with real funds. The risk gate runs again server-side at send
              time.
            </div>
          </div>
        </ConfirmModal>
      )}
    </>
  );
}
