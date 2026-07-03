import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag, StatePill } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import {
  IconBook,
  IconChart,
  IconCoins,
  IconList,
  IconPulse,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShield,
} from '../components/Icons';
import { baseOf, fmtDateTime, fmtMoney, fmtPrice, fmtQty, timeAgo } from '../format';
import type { FillRow } from '../types';

type SideFilter = 'ALL' | 'BUY' | 'SELL';
type SourceFilter = 'ALL' | string;
type MsgTone = 'ok' | 'bad' | 'warn';

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + (finite(v) ? v : 0), 0);
}

function fillKey(f: FillRow): string {
  return `${f.symbol}-${f.tradeId}`;
}

function feeSummary(fills: FillRow[]): string {
  const byAsset = new Map<string, number>();
  for (const f of fills) {
    if (!f.commissionAsset || !finite(f.commission)) continue;
    byAsset.set(f.commissionAsset, (byAsset.get(f.commissionAsset) ?? 0) + f.commission);
  }
  const entries = Array.from(byAsset.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (entries.length === 0) return 'No fees';
  const [asset, amount] = entries[0];
  return entries.length === 1 ? `${fmtQty(amount)} ${asset}` : `${fmtQty(amount)} ${asset} +${entries.length - 1}`;
}

function FillMetric({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: 'ok' | 'bad' | 'warn' | 'idle';
}) {
  return (
    <div className={`fill-metric ${tone ?? 'idle'}`}>
      <span>{icon}</span>
      <div>
        <em>{label}</em>
        <b className="num">{value}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}

function SourceTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone: 'ok' | 'warn' | 'idle';
}) {
  return (
    <div className={`fill-source-tile ${tone}`}>
      <StatePill tone={tone}>{label}</StatePill>
      <b className="num">{value}</b>
      <span>{sub}</span>
    </div>
  );
}

function FlowBars({ fills }: { fills: FillRow[] }) {
  const recent = fills.slice(0, 24).reverse();
  const max = Math.max(1e-9, ...recent.map((f) => Math.abs(f.quoteQty)));
  if (recent.length === 0) {
    return (
      <div className="fill-flow-empty">
        <span />
        <b>Execution flow is ready.</b>
        <em>Bars appear as live fills or imported Binance trades enter the ledger.</em>
      </div>
    );
  }
  return (
    <div className="fill-flow-bars">
      {recent.map((f) => {
        const h = Math.max(7, (Math.abs(f.quoteQty) / max) * 100);
        return (
          <span key={fillKey(f)} className={`fill-flow-bar ${f.side === 'BUY' ? 'buy' : 'sell'}`} title={`${f.side} ${f.symbol} ${fmtPrice(f.quoteQty)}`}>
            <i style={{ height: `${h}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export function Fills() {
  const { state, importFills, openDetail, setPage } = useStore();
  const [fills, setFills] = useState<FillRow[]>([]);
  const [importSymbol, setImportSymbol] = useState('');
  const [importMsg, setImportMsg] = useState<{ tone: MsgTone; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<SideFilter>('ALL');
  const [source, setSource] = useState<SourceFilter>('ALL');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fills');
      const d = res.ok ? await res.json() : [];
      setFills(d as FillRow[]);
    } catch {
      setImportMsg({ tone: 'bad', text: 'Could not refresh fills from the local ledger.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [load, state?.recentFills.length]);

  useEffect(() => {
    if (!selectedKey && fills.length > 0) setSelectedKey(fillKey(fills[0]));
  }, [fills, selectedKey]);

  const keysPresent = !!state?.binance.keysPresent;
  const normalizedImport = importSymbol.trim().toUpperCase();
  const importDisabledReason = !keysPresent
    ? 'Read-only Binance keys must be configured on the server first'
    : normalizedImport.length < 5
      ? 'Enter a Binance symbol such as BTCUSDT'
      : '';

  const sources = useMemo(() => Array.from(new Set(fills.map((f) => f.source).filter(Boolean))).sort(), [fills]);
  const queryText = query.trim().toUpperCase();
  const filtered = useMemo(() => {
    return fills.filter((f) => {
      if (side !== 'ALL' && f.side !== side) return false;
      if (source !== 'ALL' && f.source !== source) return false;
      if (!queryText) return true;
      return (
        f.symbol.includes(queryText) ||
        String(f.tradeId).includes(queryText) ||
        String(f.orderId ?? '').includes(queryText) ||
        baseOf(f.symbol).includes(queryText)
      );
    });
  }, [fills, queryText, side, source]);

  const selected = filtered.find((f) => fillKey(f) === selectedKey) ?? filtered[0] ?? fills.find((f) => fillKey(f) === selectedKey) ?? fills[0] ?? null;
  const buyFills = fills.filter((f) => f.side === 'BUY');
  const sellFills = fills.filter((f) => f.side === 'SELL');
  const totalNotional = sum(fills.map((f) => f.quoteQty));
  const buyNotional = sum(buyFills.map((f) => f.quoteQty));
  const sellNotional = sum(sellFills.map((f) => f.quoteQty));
  const uniqueSymbols = new Set(fills.map((f) => f.symbol)).size;
  const lastTs = fills[0]?.ts ?? null;
  const topSymbols = useMemo(() => {
    const map = new Map<string, { symbol: string; notional: number; count: number; buy: number; sell: number }>();
    for (const f of fills) {
      const row = map.get(f.symbol) ?? { symbol: f.symbol, notional: 0, count: 0, buy: 0, sell: 0 };
      row.notional += f.quoteQty;
      row.count += 1;
      if (f.side === 'BUY') row.buy += f.quoteQty;
      else row.sell += f.quoteQty;
      map.set(f.symbol, row);
    }
    return Array.from(map.values()).sort((a, b) => b.notional - a.notional).slice(0, 5);
  }, [fills]);

  const runImport = async () => {
    if (importDisabledReason) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await importFills(normalizedImport);
      if (res.error) {
        setImportMsg({ tone: 'bad', text: `Import failed: ${res.error}` });
      } else {
        setImportMsg({ tone: 'ok', text: `Imported ${res.imported ?? 0} new fills for ${normalizedImport}` });
        setImportSymbol('');
      }
      await load();
    } finally {
      setImporting(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setSide('ALL');
    setSource('ALL');
  };

  return (
    <div className="container page fills-page">
      <section className="fills-hero card">
        <div className="fills-hero-copy">
          <span className="fills-eyebrow"><IconReceipt size={15} /> execution ledger</span>
          <h1 className="page-title">Fills</h1>
          <p>
            Binance-style execution history with Coinbase-grade clarity: every fill is ledgered, filterable, inspectable,
            and wired back into PnL attribution.
          </p>
          <div className="fills-hero-actions">
            <button className="cta-pill" type="button" onClick={() => setPage('pnl')}>
              <IconChart size={14} />
              PnL impact
            </button>
            <button className="mini-btn" type="button" onClick={() => setPage('ledger')}>
              <IconBook size={14} />
              Audit ledger
            </button>
            <button className="mini-btn" type="button" onClick={load} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="fills-hero-panel">
          <StatePill tone={fills.length ? 'ok' : keysPresent ? 'warn' : 'idle'}>
            {fills.length ? 'ledger active' : keysPresent ? 'ready to import' : 'keys not set'}
          </StatePill>
          <span>Executed notional</span>
          <b className="num">{fmtMoney(totalNotional)}</b>
          <em>{fills.length ? `${fills.length} fills across ${uniqueSymbols} symbols` : 'waiting for live fills or import'}</em>
          <FlowBars fills={fills} />
        </div>
      </section>

      <section className="fill-metric-grid">
        <FillMetric icon={<IconList size={16} />} label="Fills tracked" value={fills.length.toLocaleString('en-US')} sub={lastTs ? `last ${timeAgo(lastTs)}` : 'empty local ledger'} tone={fills.length ? 'ok' : 'idle'} />
        <FillMetric icon={<IconPulse size={16} />} label="Buy / sell flow" value={`${fmtMoney(buyNotional)} / ${fmtMoney(sellNotional)}`} sub={`${buyFills.length} buys · ${sellFills.length} sells`} tone={buyFills.length || sellFills.length ? 'ok' : 'idle'} />
        <FillMetric icon={<IconCoins size={16} />} label="Commissions" value={feeSummary(fills)} sub="as reported by Binance trades" tone={fills.length ? 'warn' : 'idle'} />
        <FillMetric icon={<IconShield size={16} />} label="Safety" value={state?.mode ?? 'HALTED'} sub="read-only view, no withdrawal path" tone={state?.mode === 'LIVE_ARMED' ? 'warn' : 'ok'} />
      </section>

      <section className="fills-source-strip">
        <SourceTile label="Stream" value={state?.binance.connected ? 'online' : 'offline'} sub="user stream or polling fallback" tone={state?.binance.connected ? 'ok' : keysPresent ? 'warn' : 'idle'} />
        <SourceTile label="Import" value={keysPresent ? 'available' : 'locked'} sub={keysPresent ? 'last 200 trades per symbol' : 'server keys missing'} tone={keysPresent ? 'ok' : 'idle'} />
        <SourceTile label="Coverage" value={uniqueSymbols || '—'} sub="symbols with executions" tone={uniqueSymbols ? 'ok' : 'idle'} />
        <SourceTile label="Source" value={sources.length || '—'} sub={sources.length ? sources.join(', ') : 'no fill sources yet'} tone={sources.length ? 'ok' : 'idle'} />
      </section>

      <section className="fills-tools card">
        <div className="fills-filter-row">
          <label className="fills-search">
            <IconSearch size={14} />
            <input
              placeholder="Search symbol, order id, trade id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="seg fills-seg">
            {(['ALL', 'BUY', 'SELL'] as SideFilter[]).map((s) => (
              <button key={s} className={side === s ? `on ${s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : ''}` : ''} type="button" onClick={() => setSide(s)}>
                {s === 'ALL' ? 'All sides' : s}
              </button>
            ))}
          </div>
          <div className="seg fills-seg source">
            <button className={source === 'ALL' ? 'on' : ''} type="button" onClick={() => setSource('ALL')}>All sources</button>
            {sources.map((s) => (
              <button key={s} className={source === s ? 'on' : ''} type="button" onClick={() => setSource(s)}>{s}</button>
            ))}
          </div>
          <button className="mini-btn" type="button" onClick={clearFilters} disabled={!query && side === 'ALL' && source === 'ALL'}>
            Clear
          </button>
        </div>

        <div className="fills-import-row">
          <div>
            <b>Import Binance trade history</b>
            <span>{importDisabledReason || 'Uses server-side read-only keys and writes every new fill to the ledger.'}</span>
          </div>
          <label className="fills-import-input">
            <span>Symbol</span>
            <input
              placeholder="BTCUSDT"
              value={importSymbol}
              onChange={(e) => setImportSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runImport();
              }}
              spellCheck={false}
            />
          </label>
          <button className="cta-pill" type="button" disabled={!!importDisabledReason || importing} title={importDisabledReason || 'Import Binance fills'} onClick={runImport}>
            <IconReceipt size={14} />
            {importing ? 'Importing' : 'Import history'}
          </button>
        </div>
        {importMsg && <div className={`result-strip ${importMsg.tone}`}>{importMsg.text}</div>}
      </section>

      <div className="fills-layout">
        <main className="fills-main card">
          <div className="fills-table-head">
            <div>
              <h2>Execution tape</h2>
              <span>{filtered.length} shown from {fills.length} ledger fills</span>
            </div>
            <StatePill tone={filtered.length ? 'ok' : fills.length ? 'warn' : 'idle'}>
              {filtered.length ? 'filtered' : fills.length ? 'no match' : 'empty'}
            </StatePill>
          </div>

          {fills.length === 0 ? (
            <div className="fills-empty">
              <EmptyState title="No fills in the ledger">
                Live executions will stream here once Binance is connected. If you already traded this account, configure read-only server keys and import a symbol to backfill history.
              </EmptyState>
              <div className="fills-empty-steps">
                <div><i>1</i><b>Connect read-only keys</b><span>server only; no frontend key input</span></div>
                <div><i>2</i><b>Import per symbol</b><span>Binance trade rows become immutable ledger fills</span></div>
                <div><i>3</i><b>Inspect execution quality</b><span>side, source, fee, notional, order id, trade id</span></div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No fills match these filters">Clear the filters or search a different symbol, trade id, or order id.</EmptyState>
          ) : (
            <div className="fills-table-wrap">
              <table className="fills-table">
                <thead>
                  <tr>
                    <th className="l">Execution</th>
                    <th className="l">Side</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Notional</th>
                    <th>Fee</th>
                    <th className="l">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const active = selected && fillKey(selected) === fillKey(f);
                    return (
                      <tr key={fillKey(f)} className={active ? 'selected' : ''} onClick={() => setSelectedKey(fillKey(f))}>
                        <td className="l">
                          <span className="fills-token-cell">
                            <TokenIcon symbol={f.symbol} size={32} />
                            <span>
                              <b>{f.symbol}</b>
                              <em>{fmtDateTime(f.ts)}</em>
                            </span>
                          </span>
                        </td>
                        <td className="l"><SideTag side={f.side} /></td>
                        <td className="num">{fmtPrice(f.price)}</td>
                        <td className="num">{fmtQty(f.qty)}</td>
                        <td className="num fill-notional">{fmtPrice(f.quoteQty)}</td>
                        <td className="num muted">{fmtQty(f.commission)} {f.commissionAsset ?? ''}</td>
                        <td className="l"><span className="chip-tag">{f.source}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="fills-rail">
          <section className="fills-inspector card">
            <div className="fills-rail-head">
              <h2>Fill inspector</h2>
              <span>{selected ? 'selected execution' : 'no execution selected'}</span>
            </div>
            {selected ? (
              <>
                <div className="fills-selected-token">
                  <TokenIcon symbol={selected.symbol} size={42} />
                  <span>
                    <b>{baseOf(selected.symbol)}</b>
                    <em>{selected.symbol}</em>
                  </span>
                  <SideTag side={selected.side} />
                </div>
                <div className="fills-inspector-grid">
                  <span><em>Price</em><b className="num">{fmtPrice(selected.price)}</b></span>
                  <span><em>Quantity</em><b className="num">{fmtQty(selected.qty)}</b></span>
                  <span><em>Notional</em><b className="num">{fmtPrice(selected.quoteQty)}</b></span>
                  <span><em>Fee</em><b className="num">{fmtQty(selected.commission)} {selected.commissionAsset ?? ''}</b></span>
                  <span><em>Order id</em><b className="num">{selected.orderId ?? '—'}</b></span>
                  <span><em>Trade id</em><b className="num">{selected.tradeId}</b></span>
                  <span><em>Source</em><b>{selected.source}</b></span>
                  <span><em>Time</em><b>{fmtDateTime(selected.ts)}</b></span>
                </div>
                <div className="fills-inspector-actions">
                  <button className="cta-pill" type="button" onClick={() => openDetail(selected.symbol)}>Open market</button>
                  <button className="mini-btn" type="button" onClick={() => setPage('pnl')}>View PnL</button>
                </div>
              </>
            ) : (
              <EmptyState title="No fill selected">Select an execution row to inspect order id, trade id, fee, and source.</EmptyState>
            )}
          </section>

          <section className="fills-inspector card">
            <div className="fills-rail-head">
              <h2>Symbol flow</h2>
              <span>notional by market</span>
            </div>
            {topSymbols.length === 0 ? (
              <EmptyState title="No symbol flow yet" />
            ) : (
              <div className="fills-symbol-flow">
                {topSymbols.map((r) => (
                  <button key={r.symbol} type="button" onClick={() => openDetail(r.symbol)}>
                    <span>
                      <TokenIcon symbol={r.symbol} size={28} />
                      <span><b>{r.symbol}</b><em>{r.count} fills</em></span>
                    </span>
                    <strong className="num">{fmtMoney(r.notional)}</strong>
                    <i style={{ width: `${Math.max(8, (r.notional / Math.max(1, topSymbols[0].notional)) * 100)}%` }} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
