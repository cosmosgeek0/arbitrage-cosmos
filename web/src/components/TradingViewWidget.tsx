import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  TradingViewChart,
  normalizeTvCandles,
  type TvCandle,
} from './TradingViewChart';
import { tradingViewClockZone } from '../lib/time';

const TV_WIDGET_SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export const TRADING_VIEW_LOAD_TIMEOUT_MS = 12_000;
export const TRADING_VIEW_FALLBACK_TIMEOUT_MS = 10_000;

export type TradingViewLiveness = Readonly<{
  status: 'LOADING' | 'EXTERNAL_READY' | 'FALLBACK_LOADING' | 'FALLBACK_READY' | 'UNAVAILABLE';
  failure: 'EXTERNAL_ERROR' | 'EXTERNAL_TIMEOUT' | 'FALLBACK_FAILURE' | null;
}>;

export type TradingViewLivenessEvent =
  | Readonly<{ kind: 'RESET' }>
  | Readonly<{ kind: 'EXTERNAL_LOAD' }>
  | Readonly<{ kind: 'EXTERNAL_ERROR' }>
  | Readonly<{ kind: 'EXTERNAL_TIMEOUT' }>
  | Readonly<{ kind: 'FALLBACK_SUCCESS' }>
  | Readonly<{ kind: 'FALLBACK_FAILURE' }>;

export const INITIAL_TRADING_VIEW_LIVENESS: TradingViewLiveness = Object.freeze({
  status: 'LOADING',
  failure: null,
});

export function reduceTradingViewLiveness(
  state: TradingViewLiveness,
  event: TradingViewLivenessEvent,
): TradingViewLiveness {
  if (event.kind === 'RESET') return INITIAL_TRADING_VIEW_LIVENESS;
  if (state.status === 'LOADING') {
    if (event.kind === 'EXTERNAL_LOAD') return { status: 'EXTERNAL_READY', failure: null };
    if (event.kind === 'EXTERNAL_ERROR' || event.kind === 'EXTERNAL_TIMEOUT') {
      return { status: 'FALLBACK_LOADING', failure: event.kind };
    }
  }
  if (state.status === 'FALLBACK_LOADING') {
    if (event.kind === 'FALLBACK_SUCCESS') return { status: 'FALLBACK_READY', failure: state.failure };
    if (event.kind === 'FALLBACK_FAILURE') return { status: 'UNAVAILABLE', failure: event.kind };
  }
  return state;
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function tvInterval(win: string): string {
  if (win === '1s') return '1S';
  if (win.endsWith('m')) return win.replace('m', '');
  if (win.endsWith('h')) return String(Number(win.replace('h', '')) * 60);
  if (win.endsWith('H')) return String(Number(win.replace('H', '')) * 60);
  if (win === '1d' || win === '1D') return 'D';
  if (win === '3d' || win === '3D') return '3D';
  if (win === '1w' || win === '1W') return 'W';
  if (win === '1M') return 'M';
  return '60';
}

function tvSymbol(symbol: string): string {
  return symbol.includes(':') ? symbol : `BINANCE:${symbol}`;
}

export function tradingViewFallbackRequest(symbol: string, win: string): string {
  const qualifiedSymbol = symbol.includes(':') ? symbol.slice(symbol.indexOf(':') + 1) : symbol;
  const market = qualifiedSymbol.endsWith('.P') ? 'futures' : 'spot';
  const canonicalSymbol = (market === 'futures' ? qualifiedSymbol.slice(0, -2) : qualifiedSymbol).toUpperCase();
  const interval = win === '1M' ? win : win.toLowerCase();
  const query = new URLSearchParams({
    symbol: canonicalSymbol,
    interval,
    limit: '1000',
    market,
  });
  return `/api/candles?${query.toString()}`;
}

function fallbackPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const maximumFractionDigits = value >= 1_000 ? 2 : value >= 1 ? 4 : 8;
  return value.toLocaleString('en-US', { maximumFractionDigits });
}

export function TradingViewWidget({ symbol, win, clockZone, height = 520 }: { symbol: string; win: string; clockZone: string; height?: number }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme());
  const [liveness, dispatchLiveness] = useReducer(
    reduceTradingViewLiveness,
    INITIAL_TRADING_VIEW_LIVENESS,
  );
  const [fallbackCandles, setFallbackCandles] = useState<TvCandle[]>([]);
  const widgetHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const config = useMemo(
    () => ({
      autosize: true,
      symbol: tvSymbol(symbol),
      interval: tvInterval(win),
      timezone: tradingViewClockZone(clockZone),
      theme,
      style: '1',
      locale: 'en',
      backgroundColor: theme === 'dark' ? 'rgba(11, 14, 22, 0)' : 'rgba(255, 255, 255, 0)',
      gridColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
      withdateranges: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      allow_symbol_change: true,
      save_image: true,
      calendar: false,
      details: false,
      hotlist: false,
      studies: ['Volume@tv-basicstudies'],
      show_popup_button: true,
      popup_width: '1280',
      popup_height: '820',
      enabled_features: ['header_fullscreen_button'],
      support_host: 'https://www.tradingview.com',
    }),
    [clockZone, symbol, theme, win]
  );

  const fallbackUrl = useMemo(() => tradingViewFallbackRequest(symbol, win), [symbol, win]);

  useEffect(() => {
    const host = widgetHostRef.current;
    if (!host) return;

    let disposed = false;
    let fallbackStarted = false;
    let loadTimer: number | null = null;
    let fallbackTimer: number | null = null;
    const fallbackController = new AbortController();

    dispatchLiveness({ kind: 'RESET' });
    setFallbackCandles([]);

    const widgetCanvas = document.createElement('div');
    widgetCanvas.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = TV_WIDGET_SCRIPT_URL;
    script.type = 'text/javascript';
    script.async = true;
    script.referrerPolicy = 'origin';
    script.textContent = JSON.stringify(config);
    host.replaceChildren(widgetCanvas);

    const startFallback = (kind: 'EXTERNAL_ERROR' | 'EXTERNAL_TIMEOUT') => {
      if (disposed || fallbackStarted) return;
      fallbackStarted = true;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      script.onload = null;
      script.onerror = null;
      host.replaceChildren();
      dispatchLiveness({ kind });

      fallbackTimer = window.setTimeout(
        () => fallbackController.abort(),
        TRADING_VIEW_FALLBACK_TIMEOUT_MS,
      );
      void fetch(fallbackUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: fallbackController.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`same-origin candle request failed (${response.status})`);
          const payload: unknown = await response.json();
          const candles = normalizeTvCandles(Array.isArray(payload) ? payload as TvCandle[] : []);
          if (candles.length < 2) throw new Error('same-origin candle request returned too few usable rows');
          if (disposed) return;
          setFallbackCandles(candles);
          dispatchLiveness({ kind: 'FALLBACK_SUCCESS' });
        })
        .catch(() => {
          if (!disposed) dispatchLiveness({ kind: 'FALLBACK_FAILURE' });
        })
        .finally(() => {
          if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        });
    };

    script.onload = () => {
      if (disposed || fallbackStarted) return;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      script.onload = null;
      script.onerror = null;
      dispatchLiveness({ kind: 'EXTERNAL_LOAD' });
    };
    script.onerror = () => startFallback('EXTERNAL_ERROR');
    loadTimer = window.setTimeout(
      () => startFallback('EXTERNAL_TIMEOUT'),
      TRADING_VIEW_LOAD_TIMEOUT_MS,
    );
    host.appendChild(script);

    return () => {
      disposed = true;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      script.onload = null;
      script.onerror = null;
      fallbackController.abort();
      host.replaceChildren();
    };
  }, [config, fallbackUrl]);

  const showExternal = liveness.status === 'LOADING' || liveness.status === 'EXTERNAL_READY';

  return (
    <div className="tv-widget-wrap" style={{ height }}>
      <div
        ref={widgetHostRef}
        className="tradingview-widget-container"
        hidden={!showExternal}
        aria-hidden={!showExternal}
      />
      {liveness.status === 'LOADING' ? (
        <div className="tv-widget-fallback" role="status">Loading TradingView chart…</div>
      ) : null}
      {liveness.status === 'FALLBACK_LOADING' ? (
        <div className="tv-widget-fallback" role="status">
          TradingView unavailable · loading same-origin candle chart…
        </div>
      ) : null}
      {liveness.status === 'FALLBACK_READY' ? (
        <div aria-label={`${tvSymbol(symbol)} same-origin candle chart`}>
          <TradingViewChart
            candles={fallbackCandles}
            kind="candles"
            height={height}
            valueFmt={fallbackPrice}
            resetKey={`${symbol}:${win}:same-origin-fallback`}
            clockZone={clockZone}
            tools
          />
          <span
            role="status"
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 3,
              padding: '5px 8px',
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--panel)',
              color: 'var(--muted)',
              fontSize: 10,
              fontWeight: 650,
            }}
          >
            Same-origin candle fallback
          </span>
        </div>
      ) : null}
      {liveness.status === 'UNAVAILABLE' ? (
        <div className="tv-widget-fallback" role="alert">
          Chart unavailable · TradingView and same-origin candles could not be loaded.
        </div>
      ) : null}
    </div>
  );
}
