import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Page } from '../store';
import { TokenIcon } from './TokenIcon';
import { IconSearch } from './Icons';
import { fmtPrice, fmtPct, signClass } from '../format';

const PAGES: { page: Page; name: string; sub: string }[] = [
  { page: 'dashboard', name: 'Dashboard', sub: 'Operator overview' },
  { page: 'account', name: 'Account', sub: 'Connection & permissions' },
  { page: 'wallets', name: 'Wallets / Assets', sub: 'Spot · margin · futures' },
  { page: 'markets', name: 'Markets', sub: 'Token universe · spot+perp' },
  { page: 'loans', name: 'Borrow / Margin', sub: 'Borrowability preflight' },
  { page: 'strategies', name: 'Basis Scanner', sub: 'Spot/perp gap engine' },
  { page: 'volume', name: 'Volume Scanner', sub: 'Volume-spike engine' },
  { page: 'opportunities', name: 'Opportunities', sub: 'Proposal queue' },
  { page: 'trade', name: 'Execution', sub: 'Ticket · orders · positions · fills · PnL' },
  { page: 'orders', name: 'Execution · Orders', sub: 'Open & history' },
  { page: 'positions', name: 'Execution · Positions', sub: 'Holdings & unrealized' },
  { page: 'fills', name: 'Execution · Fills', sub: 'Executions' },
  { page: 'pnl', name: 'Execution · PnL', sub: 'Daily realized & equity' },
  { page: 'risk', name: 'Risk', sub: 'Kill switch · limits · rules' },
  { page: 'ledger', name: 'Ledger / Logs', sub: 'Full audit trail' },
  { page: 'system', name: 'System Health', sub: 'Feeds, latency, limits' },
  { page: 'settings', name: 'Settings', sub: 'Local preferences' },
  { page: 'news', name: 'Binance News', sub: 'Announcements' },
  { page: 'calendar', name: 'Economic Calendar', sub: 'Macro events' },
];

export function Palette() {
  const { paletteOpen, setPaletteOpen, markets, setPage, openDetail } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '/' && !inField) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [paletteOpen]);

  const results = useMemo(() => {
    const query = q.trim().toUpperCase();
    const pages = PAGES.filter(
      (p) => !query || p.name.toUpperCase().includes(query) || p.sub.toUpperCase().includes(query)
    ).slice(0, query ? 4 : 5);
    const syms = query
      ? markets.filter((m) => m.symbol.includes(query) || m.base.includes(query)).slice(0, 8)
      : markets.slice(0, 6);
    return { pages, syms };
  }, [q, markets]);

  if (!paletteOpen) return null;

  const flat: { kind: 'page' | 'sym'; idx: number }[] = [
    ...results.pages.map((_, i) => ({ kind: 'page' as const, idx: i })),
    ...results.syms.map((_, i) => ({ kind: 'sym' as const, idx: i })),
  ];
  const clampedSel = Math.min(sel, Math.max(0, flat.length - 1));

  const choose = (i: number) => {
    const f = flat[i];
    if (!f) return;
    setPaletteOpen(false);
    if (f.kind === 'page') setPage(results.pages[f.idx].page);
    else openDetail(results.syms[f.idx].symbol);
  };

  return (
    <div className="overlay" onClick={() => setPaletteOpen(false)}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <IconSearch size={17} />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search tokens or pages…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel(Math.min(clampedSel + 1, flat.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel(Math.max(clampedSel - 1, 0));
              } else if (e.key === 'Enter') {
                choose(clampedSel);
              } else if (e.key === 'Escape') {
                setPaletteOpen(false);
              }
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmd-list">
          {results.pages.length > 0 && <div className="cmd-group">Pages</div>}
          {results.pages.map((p, i) => (
            <button
              key={p.page}
              className={`cmd-item ${clampedSel === i ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              <span>
                <div className="c-name">{p.name}</div>
                <div className="c-sub">{p.sub}</div>
              </span>
            </button>
          ))}
          {results.syms.length > 0 && <div className="cmd-group">Tokens</div>}
          {results.syms.map((m, i) => {
            const fi = results.pages.length + i;
            return (
              <button
                key={m.symbol}
                className={`cmd-item ${clampedSel === fi ? 'sel' : ''}`}
                onMouseEnter={() => setSel(fi)}
                onClick={() => choose(fi)}
              >
                <TokenIcon symbol={m.symbol} size={24} />
                <span>
                  <div className="c-name">{m.base}</div>
                  <div className="c-sub">{m.symbol}</div>
                </span>
                <span className={`c-right ${signClass(m.change24hPct)}`}>
                  {fmtPrice(m.spot)} · {fmtPct(m.change24hPct, 1)}
                </span>
              </button>
            );
          })}
          {flat.length === 0 && <div className="cmd-empty">Nothing matches “{q}”.</div>}
        </div>
        <div className="cmd-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
