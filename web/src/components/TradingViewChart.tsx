import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LastPriceAnimationMode,
  LineSeries,
  PriceScaleMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface TvCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  qv: number;
}

export interface TvPoint {
  t: number;
  v: number;
}

type Kind = 'candles' | 'line' | 'histogram';

function timeOf(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartTheme() {
  return {
    text: css('--muted', '#6b7280'),
    grid: css('--line', 'rgba(148, 163, 184, .18)'),
    faint: css('--faint', '#94a3b8'),
    up: css('--up', '#16a34a'),
    down: css('--down', '#ef4444'),
    accent: css('--accent', '#0ea5e9'),
  };
}

function fmtTime(ts: UTCTimestamp): string {
  const d = new Date(Number(ts) * 1000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function TradingViewChart({
  candles,
  points,
  kind,
  height = 520,
  color,
  valueFmt,
  resetKey,
  tools = false,
}: {
  candles?: TvCandle[];
  points?: TvPoint[];
  kind: Kind;
  height?: number;
  color?: string;
  valueFmt: (v: number) => string;
  resetKey: string;
  /** Interactive tool rail (zoom/fit/live/log/volume/MA) — token page only. */
  tools?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const fmtRef = useRef(valueFmt);
  const fittedKeyRef = useRef<string | null>(null);
  const maRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const [logScale, setLogScale] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const [showMa, setShowMa] = useState(false);

  fmtRef.current = valueFmt;

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const candleData = useMemo<CandlestickData[]>(() => {
    return (candles ?? []).map((d) => ({
      time: timeOf(d.t),
      open: d.o,
      high: d.h,
      low: d.l,
      close: d.c,
    }));
  }, [candles]);

  const volumeData = useMemo<HistogramData[]>(() => {
    return (candles ?? []).map((d) => ({
      time: timeOf(d.t),
      value: d.qv || d.v,
      color: d.c >= d.o ? 'rgba(22, 163, 74, .42)' : 'rgba(239, 68, 68, .42)',
    }));
  }, [candles, themeTick]);

  const lineData = useMemo<LineData[]>(() => (points ?? []).map((d) => ({ time: timeOf(d.t), value: d.v })), [points]);
  const histData = useMemo<HistogramData[]>(
    () =>
      (points ?? []).map((d, i, arr) => ({
        time: timeOf(d.t),
        value: d.v,
        color: i === 0 || d.v >= arr[i - 1].v ? 'rgba(22, 163, 74, .58)' : 'rgba(239, 68, 68, .58)',
      })),
    [points]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const t = chartTheme();
    const chart = createChart(host, {
      width: host.clientWidth,
      height,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: t.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      localization: {
        priceFormatter: (v) => fmtRef.current(v),
        timeFormatter: (time) => (typeof time === 'number' ? fmtTime(time as UTCTimestamp) : String(time)),
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, .10)' },
        horzLines: { color: t.grid },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(100, 116, 139, .34)', labelBackgroundColor: t.accent },
        horzLine: { color: 'rgba(100, 116, 139, .34)', labelBackgroundColor: t.accent },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: kind === 'candles' ? 0.22 : 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 8,
        barSpacing: kind === 'candles' ? 7 : 5,
        minBarSpacing: 0.5,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;
    candleRef.current = null;
    volumeRef.current = null;
    lineRef.current = null;
    histRef.current = null;
    maRef.current = null;
    fittedKeyRef.current = null;

    if (kind === 'candles') {
      candleRef.current = chart.addSeries(CandlestickSeries, {
        upColor: t.up,
        downColor: t.down,
        borderUpColor: t.up,
        borderDownColor: t.down,
        wickUpColor: t.up,
        wickDownColor: t.down,
        lastValueVisible: true,
        priceLineVisible: true,
        lastPriceAnimation: LastPriceAnimationMode.Continuous,
      });
      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
    } else if (kind === 'line') {
      lineRef.current = chart.addSeries(LineSeries, {
        color: color ?? t.accent,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        lastPriceAnimation: LastPriceAnimationMode.Continuous,
      });
    } else {
      histRef.current = chart.addSeries(HistogramSeries, {
        color: color ?? t.accent,
        priceFormat: { type: 'volume' },
        lastValueVisible: true,
        priceLineVisible: true,
      });
    }

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [kind, height, color, themeTick]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (kind === 'candles') {
      candleRef.current?.setData(candleData);
      volumeRef.current?.setData(volumeData);
    } else if (kind === 'line') {
      lineRef.current?.setData(lineData);
    } else {
      histRef.current?.setData(histData);
    }
    if (fittedKeyRef.current !== resetKey) {
      chartRef.current.timeScale().fitContent();
      fittedKeyRef.current = resetKey;
    }
  }, [kind, candleData, volumeData, lineData, histData, resetKey]);

  // ---- tool rail wiring (token page TV mode only) --------------------------
  useEffect(() => {
    chartRef.current?.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
  }, [logScale, themeTick, kind]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVol });
  }, [showVol, themeTick, kind, candleData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || kind !== 'candles') return;
    if (showMa && candleData.length >= 20) {
      if (!maRef.current) {
        maRef.current = chart.addSeries(LineSeries, {
          color: '#8257e0',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      const ma: LineData[] = [];
      let sum = 0;
      for (let i = 0; i < candleData.length; i++) {
        sum += (candleData[i] as { close: number }).close;
        if (i >= 20) sum -= (candleData[i - 20] as { close: number }).close;
        if (i >= 19) ma.push({ time: candleData[i].time, value: sum / 20 });
      }
      maRef.current.setData(ma);
    } else if (maRef.current) {
      chartRef.current?.removeSeries(maRef.current);
      maRef.current = null;
    }
  }, [showMa, candleData, kind, themeTick]);

  const zoom = (factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const cur = chart.timeScale().options().barSpacing;
    chart.timeScale().applyOptions({ barSpacing: Math.max(0.5, Math.min(60, cur * factor)) });
  };

  const empty =
    kind === 'candles'
      ? candleData.length < 2
      : kind === 'line'
        ? lineData.length < 2
        : histData.length < 2;

  return (
    <div className="tv-chart-wrap" style={{ height }}>
      <div ref={hostRef} className="tv-chart-canvas" />
      {tools && (
        <div className="tvx-rail" role="toolbar" aria-label="Chart tools">
          <button type="button" title="Zoom In" onClick={() => zoom(1.35)}>＋</button>
          <button type="button" title="Zoom Out" onClick={() => zoom(1 / 1.35)}>－</button>
          <button type="button" title="Fit All" onClick={() => chartRef.current?.timeScale().fitContent()}>⤢</button>
          <button type="button" title="Jump To Live" onClick={() => chartRef.current?.timeScale().scrollToRealTime()}>▶</button>
          <span className="tvx-sep" />
          <button type="button" title="Log Scale" className={logScale ? 'on' : ''} aria-pressed={logScale} onClick={() => setLogScale((v) => !v)}>Log</button>
          {kind === 'candles' && (
            <>
              <button type="button" title="Volume" className={showVol ? 'on' : ''} aria-pressed={showVol} onClick={() => setShowVol((v) => !v)}>Vol</button>
              <button type="button" title="20-Bar Moving Average" className={showMa ? 'on' : ''} aria-pressed={showMa} onClick={() => setShowMa((v) => !v)}>MA</button>
            </>
          )}
        </div>
      )}
      {empty && <div className="tv-chart-empty">Waiting for Binance candles…</div>}
    </div>
  );
}
