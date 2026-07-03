import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { ConfirmModal } from '../components/Modal';
import { SideTag, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { Num } from '../components/Num';
import { OrderBook } from '../components/OrderBook';
import { IconAlert, IconBook, IconChart, IconClock, IconList, IconRefresh, IconShield, IconTicket, IconWallet } from '../components/Icons';
import { fmtPrice, fmtPct, signClass, baseOf } from '../format';
import type { PreviewResult, Quote, SendResult, Side, OrderType } from '../types';

function positiveInput(v: string): boolean {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n > 0;
}

function capPct(value: number | null, cap: number | null): number {
  if (value === null || cap === null || !Number.isFinite(value) || !Number.isFinite(cap) || cap <= 0) return 0;
  return Math.max(0, Math.min(100, (value / cap) * 100));
}

export function ManualTrade() {
  const { state, ticket, clearTicket, preview, testOrder, sendLive, openDetail, setPage } = useStore();
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
  const dailyLimit = state?.config.maxDailyNotionalUsd ?? null;
  const dailyUsed = state?.risk.dailyNotionalUsedUsd ?? null;
  const dailyRemaining =
    dailyLimit !== null && dailyUsed !== null ? Math.max(0, dailyLimit - dailyUsed) : null;
  const openOrdersForSymbol = state?.openOrders.filter((o) => o.symbol === symbol).length ?? 0;
  const allowlisted = state?.config.allowedSymbols.includes(symbol) ?? false;
  const blocked = state?.config.blockedSymbols.includes(symbol) ?? false;
  const hasPrice = type === 'MARKET' || positiveInput(price);
  const hasSize = type === 'MARKET' ? positiveInput(qty) || positiveInput(quoteQty) : positiveInput(qty);
  const canPreview = symbolValid && hasPrice && hasSize && !busy;
  const canValidate = canPreview && keysPresent;
  const notionalPct = capPct(draftNotional, maxPerOrder);
  const dailyPct = capPct(dailyUsed, dailyLimit);
  const quoteFresh = !!quote;
  const previewTone = riskPassed ? 'ok' : pv ? 'bad' : 'idle';
  const validateTone = testResult?.ok ? 'ok' : testResult ? 'bad' : 'idle';
  const sendTone = sendResult?.sent ? 'ok' : sendResult ? 'bad' : canShowLiveButton ? 'warn' : 'idle';
  const tifCopy =
    tif === 'GTC'
      ? 'Rest until filled or cancelled.'
      : tif === 'IOC'
        ? 'Take what is available now, cancel the rest.'
        : 'Fill the entire size immediately or cancel.';
  const pricePicks = [
    { label: 'Bid', value: quote?.book?.bidPrice ?? null, tone: 'up' },
    { label: 'Ask', value: quote?.book?.askPrice ?? null, tone: 'down' },
    { label: 'Last', value: quote?.last ?? null, tone: '' },
  ];
  const preflight = useMemo(
    () => [
      {
        label: 'Symbol',
        detail: symbolValid ? `${symbol} format accepted` : 'Use a Binance symbol like BTCUSDT',
        pass: symbolValid,
      },
      {
        label: 'Market data',
        detail: quoteFresh ? (quote?.tradable === false ? 'Symbol exists but is not spot-tradable' : 'Quote and book stream available') : 'Waiting for quote',
        pass: quoteFresh && quote?.tradable !== false,
      },
      {
        label: 'Price and size',
        detail: hasPrice && hasSize ? `${type} draft ${fmtPrice(draftNotional)}` : 'Enter a valid price/size before preview',
        pass: hasPrice && hasSize,
      },
      {
        label: 'Allowlist',
        detail: allowlisted
          ? `${symbol} is on the live allowlist`
          : state?.config.allowedSymbols.length
            ? `${symbol} is not on the live allowlist`
            : 'Allowlist is empty, live send will be rejected',
        pass: allowlisted,
      },
      {
        label: 'Blocked list',
        detail: blocked ? `${symbol} is blocked` : 'Not blocked',
        pass: !blocked,
      },
      {
        label: 'Risk preview',
        detail: riskPassed ? 'All preview checks pass' : pv ? pv.risk.reasons.join(' · ') || 'Preview rejected' : 'Run preview before validation/live send',
        pass: riskPassed,
      },
    ],
    [allowlisted, blocked, draftNotional, hasPrice, hasSize, pv, quote?.tradable, quoteFresh, riskPassed, state?.config.allowedSymbols.length, symbol, symbolValid, type]
  );
  const pipeline = [
    { label: 'Draft', tone: hasPrice && hasSize && symbolValid ? 'ok' : 'warn', detail: 'symbol, side, price, size' },
    { label: 'Preview', tone: previewTone, detail: 'server filters + risk gate' },
    { label: 'Validate', tone: validateTone, detail: 'signed Binance test order' },
    { label: 'Confirm', tone: sendTone, detail: `type ${symbol} before live send` },
  ];

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
    <div className="container page manual-trade-page">
      <section className="manual-hero card" data-side={side}>
        <div className="manual-hero-main">
          <div className="trade-identity">
            <TokenIcon symbol={symbol} size={54} />
            <div>
              <div className="manual-kicker">server-gated spot execution</div>
              <h1 className="page-title">Manual Trade</h1>
              <div className="page-sub">
                Draft the ticket, preview filters and risk, optionally validate with Binance, then typed-confirm live.
              </div>
            </div>
          </div>
          <div className="manual-hero-actions">
            <button className="mini-btn" disabled={!symbolValid} title={symbolValid ? `Open ${symbol} detail` : 'Enter a valid symbol'} onClick={() => openDetail(symbol)}>
              <IconChart size={14} />
              Token detail
            </button>
            <button className="mini-btn" onClick={() => setPage('orders')}>
              <IconList size={14} />
              Open orders
            </button>
            <button className="mini-btn" onClick={() => setPage('risk')}>
              <IconShield size={14} />
              Risk policy
            </button>
          </div>
        </div>

        <div className="manual-hero-side">
          <div className="manual-live-price">
            <span className="manual-kicker">{symbol || 'symbol'} live reference</span>
            <Num value={quote?.last ?? null} className="headline-val">
              <span>{fmtPrice(quote?.last)}</span>
            </Num>
            <span className={`hl-chip num ${signClass(quote?.change24hPct)}`}>{fmtPct(quote?.change24hPct, 2)} 24h</span>
          </div>
          <div className="manual-mode-stack">
            <StatePill tone={liveTone}>{mode === 'LIVE_ARMED' ? 'Live armed' : mode.toLowerCase()}</StatePill>
            <StatePill tone={keysTone}>{keysPresent ? 'Keys present' : 'No keys'}</StatePill>
            {source === 'proposal' && <span className="chip-tag gold">proposal prefill</span>}
          </div>
        </div>

        <div className="trade-pipeline">
          {pipeline.map((step, i) => (
            <div key={step.label} className={`trade-step ${step.tone}`}>
              <span className="trade-step-num">{i + 1}</span>
              <span className="trade-step-main">
                <b>{step.label}</b>
                <span>{step.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

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

            <div className="trade-route-strip">
              <div>
                <span className="k">Route</span>
                <b>Binance spot REST</b>
              </div>
              <div>
                <span className="k">Source</span>
                <b>{source === 'proposal' ? 'Proposal prefill' : 'Manual ticket'}</b>
              </div>
              <div>
                <span className="k">Confirmation</span>
                <b>Type {symbol}</b>
              </div>
            </div>

            <div className="trade-draft-grid trade-draft-grid-4">
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
              <div>
                <span className="k">Daily room</span>
                <span className="v num">{fmtPrice(dailyRemaining)}</span>
              </div>
            </div>

            <div className="trade-cap-grid">
              <div className="trade-cap-card">
                <div className="cap-meter-head">
                  <span>Per-order cap</span>
                  <b className="num">{fmtPrice(draftNotional)} / {fmtPrice(maxPerOrder)}</b>
                </div>
                <span className="cap-meter">
                  <span className={notionalPct > 90 ? 'bad' : notionalPct > 70 ? 'warn' : 'ok'} style={{ width: `${notionalPct}%` }} />
                </span>
              </div>
              <div className="trade-cap-card">
                <div className="cap-meter-head">
                  <span>Daily usage</span>
                  <b className="num">{fmtPrice(dailyUsed)} / {fmtPrice(dailyLimit)}</b>
                </div>
                <span className="cap-meter">
                  <span className={dailyPct > 90 ? 'bad' : dailyPct > 70 ? 'warn' : 'ok'} style={{ width: `${dailyPct}%` }} />
                </span>
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

            <div className="trade-price-picks">
              <span className="trade-field-label">Load price</span>
              <div className="price-pick-row">
                {pricePicks.map((p) => (
                  <button
                    key={p.label}
                    className={`price-pick ${p.tone}`}
                    disabled={p.value === null || busy}
                    title={p.value === null ? 'Waiting for market data' : `Use ${p.label.toLowerCase()} as the limit price`}
                    onClick={() => p.value !== null && useBookPrice(p.value)}
                  >
                    <span>{p.label}</span>
                    <b className="num">{fmtPrice(p.value)}</b>
                  </button>
                ))}
              </div>
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
                  {[6, 10].map((usd) => (
                    <button
                      key={usd}
                      className="qsize-chip"
                      title={type === 'MARKET' ? `Set quote amount to $${usd}` : `Size ~$${usd} at the draft price`}
                      onClick={() => applyQuickSize(usd)}
                    >
                      {usd === 6 ? 'Min $6' : `$${usd}`}
                    </button>
                  ))}
                  {maxPerOrder !== null && (
                    <button
                      className="qsize-chip max"
                      title={`Your per-order risk cap: $${maxPerOrder}`}
                      onClick={() => applyQuickSize(maxPerOrder)}
                      disabled={busy || (type === 'LIMIT' && (!draftPrice || draftPrice <= 0))}
                    >
                      Max ${maxPerOrder}
                    </button>
                  )}
                  {[0.25, 0.5].map((pct) => (
                    <button
                      key={pct}
                      className="qsize-chip"
                      disabled={maxPerOrder === null || busy || (type === 'LIMIT' && (!draftPrice || draftPrice <= 0))}
                      title={maxPerOrder === null ? 'Risk cap unavailable' : `Size ${(pct * 100).toFixed(0)}% of the per-order cap`}
                      onClick={() => maxPerOrder !== null && applyQuickSize(maxPerOrder * pct)}
                    >
                      {(pct * 100).toFixed(0)}% cap
                    </button>
                  ))}
                  <button className="qsize-chip ghost" disabled={!qty && !quoteQty} onClick={() => { setQty(''); setQuoteQty(''); }}>
                    Clear
                  </button>
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
                  <span className="trade-help">{tifCopy}</span>
                </div>
              )}
            </div>

            <div className="ticket-actions">
              <button
                className="cta-pill"
                disabled={!canPreview}
                title={canPreview ? 'Preview filters and risk checks' : busy ? 'Working' : 'Enter a valid symbol, price, and size'}
                onClick={doPreview}
              >
                <IconTicket size={15} />
                Preview
              </button>
              <button className="mini-btn" disabled={busy} onClick={reset} title="Clear the ticket">
                <IconRefresh size={14} />
                Reset
              </button>
              <button
                className="mini-btn"
                disabled={!canValidate}
                title={
                  canValidate
                    ? 'Signed validation against Binance — nothing is placed'
                    : !keysPresent
                      ? 'Needs Binance keys'
                      : 'Preview-ready ticket required'
                }
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

            <div className="preflight-board">
              {preflight.map((row) => (
                <div key={row.label} className={`preflight-row ${row.pass ? 'pass' : 'fail'}`}>
                  <span className="preflight-dot">{row.pass ? '✓' : <IconAlert size={12} />}</span>
                  <span>
                    <b>{row.label}</b>
                    <small>{row.detail}</small>
                  </span>
                </div>
              ))}
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
                  <IconBook size={15} />
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
              <span className="k">Best bid</span>
              <span className="v num up">{fmtPrice(quote?.book?.bidPrice)}</span>
            </div>
            <div className="quote-meta-row">
              <span className="k">Best ask</span>
              <span className="v num down">{fmtPrice(quote?.book?.askPrice)}</span>
            </div>
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
                  <IconClock size={18} />
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
