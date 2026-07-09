import { useEffect, useMemo, useState } from 'react';

const TV_WIDGET_URL = 'https://www.tradingview-widget.com/embed-widget/advanced-chart/';

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function tvInterval(win: string): string {
  if (win === '1s') return '1';
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

export function TradingViewWidget({ symbol, win, height = 520 }: { symbol: string; win: string; height?: number }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme());

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
      timezone: 'Etc/UTC',
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
    [symbol, theme, win]
  );

  const frameSrc = useMemo(() => `${TV_WIDGET_URL}?locale=en#${encodeURIComponent(JSON.stringify(config))}`, [config]);

  return (
    <div className="tv-widget-wrap" style={{ height }}>
      <iframe
        key={frameSrc}
        title={`${tvSymbol(symbol)} TradingView Advanced Chart`}
        src={frameSrc}
        loading="eager"
        referrerPolicy="origin"
        allowFullScreen
      />
      <div className="tv-widget-fallback">Loading TradingView chart…</div>
    </div>
  );
}
