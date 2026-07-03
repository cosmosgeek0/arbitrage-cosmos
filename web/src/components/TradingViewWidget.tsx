import { useEffect, useMemo, useRef, useState } from 'react';

const TV_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function tvInterval(win: string): string {
  if (win === '1s') return '1';
  if (win.endsWith('m')) return win.replace('m', '');
  if (win === '1H') return '60';
  if (win === '4H') return '240';
  if (win === '1D') return 'D';
  if (win === '1W') return 'W';
  return '60';
}

export function TradingViewWidget({ symbol, win, height = 520 }: { symbol: string; win: string; height?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme());

  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const config = useMemo(
    () => ({
      autosize: true,
      symbol: `BINANCE:${symbol}`,
      interval: tvInterval(win),
      timezone: 'Etc/UTC',
      theme,
      style: '1',
      locale: 'en',
      backgroundColor: theme === 'dark' ? 'rgba(11, 14, 22, 0)' : 'rgba(255, 255, 255, 0)',
      gridColor: theme === 'dark' ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    }),
    [symbol, theme, win]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = TV_SCRIPT;
    script.innerHTML = JSON.stringify(config);

    host.appendChild(widget);
    host.appendChild(script);

    return () => {
      host.innerHTML = '';
    };
  }, [config]);

  return (
    <div className="tv-widget-wrap" style={{ height }}>
      <div ref={hostRef} className="tradingview-widget-container" />
      <div className="tv-widget-fallback">Loading TradingView chart…</div>
    </div>
  );
}
