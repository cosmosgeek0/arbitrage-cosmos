import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { Empty, Pill, Seg } from '../components/px';
import { TokenIcon } from '../components/TokenIcon';
import { IconReceipt, IconRefresh } from '../components/Icons';
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

export function Fills() {
  const { state, importFills, openDetail, setPage, prefs } = useStore();
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
    const t = window.setInterval(load, Math.max(0.5, prefs.dataCadence?.account ?? 30) * 1000);
    return () => window.clearInterval(t);
  }, [load, state?.recentFills.length, prefs.dataCadence?.account]);
  useRefreshSignal(() => void load());

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

  return (
    <>
      <div className="hp-stats exec-stats">
        <div className="hp-stat">
          <span className="k">Executed notional</span>
          <span className="v">{fmtMoney(totalNotional)}</span>
          <span className="s">{fills.length ? `${fills.length} fills · ${uniqueSymbols} symbols · last ${lastTs ? timeAgo(lastTs) : '—'}` : 'waiting for live fills or import'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Buy / sell flow</span>
          <span className="v">{fmtMoney(buyNotional)} / {fmtMoney(sellNotional)}</span>
          <span className="s">{buyFills.length} buys · {sellFills.length} sells</span>
        </div>
        <div className="hp-stat">
          <span className="k">Commissions</span>
          <span className="v">{feeSummary(fills)}</span>
          <span className="s">as reported by Binance trades</span>
        </div>
      </div>

      <div className="lg-filters">
        <input
          className="hp-input lg-search"
          placeholder="Search symbol, order id, trade id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <Seg
          value={side}
          options={[
            { id: 'ALL', label: 'All' },
            { id: 'BUY', label: 'Buy' },
            { id: 'SELL', label: 'Sell' },
          ]}
          onChange={setSide}
        />
        {sources.length > 0 && (
          <select className="hp-input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="ALL">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <button className="hp-btn" type="button" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={13} />
          Refresh
        </button>
        <span className="lg-filter-gap" />
        <input
          className="hp-input lg-symbol"
          placeholder="BTCUSDT"
          value={importSymbol}
          onChange={(e) => setImportSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runImport();
          }}
          spellCheck={false}
        />
        <button
          className="hp-btn"
          type="button"
          disabled={!!importDisabledReason || importing}
          title={importDisabledReason || 'Import the last 200 Binance trades for this symbol into the ledger'}
          onClick={runImport}
        >
          <IconReceipt size={13} />
          {importing ? 'Importing…' : 'Import history'}
        </button>
      </div>

      {importMsg && (
        <div className={importMsg.tone === 'bad' ? 'hp-alert' : 'hp-note'} style={{ marginBottom: 12 }}>
          {importMsg.text}
        </div>
      )}

      <div className={`lg-grid exec-grid ${selected ? '' : 'solo'}`}>
        <section className="hp-group lg-feed" aria-label="Execution tape">
          <div className="lg-feed-head">
            <h3>Execution tape</h3>
            <span className="hp-val">{filtered.length} of {fills.length} ledger fills</span>
          </div>
          {fills.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No fills in the ledger">
                Live executions stream here once Binance is connected. Already traded on this account? Import a symbol to backfill history — rows become immutable ledger fills.
              </Empty>
            </div>
          ) : filtered.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title="No fills match these filters">Clear the filters or search a different symbol, trade id, or order id.</Empty>
            </div>
          ) : (
            <div className="hp-table-wrap">
              <table className="hp-table exec-table">
                <colgroup>
                  <col style={{ width: 150 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 120 }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Execution</th>
                    <th>Side</th>
                    <th className="num-r">Price</th>
                    <th className="num-r">Quantity</th>
                    <th className="num-r">Notional</th>
                    <th className="num-r">Fee</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const active = selected && fillKey(selected) === fillKey(f);
                    return (
                      <tr key={fillKey(f)} className={active ? 'selected' : ''} onClick={() => setSelectedKey(fillKey(f))}>
                        <td className="t-source" title={fmtDateTime(f.ts)}>
                          <span className="exec-sym">
                            <TokenIcon symbol={f.symbol} size={16} />
                            {f.symbol}
                          </span>
                        </td>
                        <td><Pill tone={f.side === 'BUY' ? 'ok' : 'bad'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</Pill></td>
                        <td className="t-value num-r">{fmtPrice(f.price)}</td>
                        <td className="t-value num-r">{fmtQty(f.qty)}</td>
                        <td className="t-value num-r">{fmtPrice(f.quoteQty)}</td>
                        <td className="t-value num-r t-layer">{fmtQty(f.commission)} {f.commissionAsset ?? ''}</td>
                        <td className="t-layer">{f.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected && <aside className="hp-group lg-inspect" aria-label="Fill inspector">
          {selected ? (
            <>
              <div className="lg-inspect-head">
                <Pill tone={selected.side === 'BUY' ? 'ok' : 'bad'}>{selected.side === 'BUY' ? 'Buy' : 'Sell'}</Pill>
                <h3>{baseOf(selected.symbol)} fill</h3>
                <span>trade #{selected.tradeId} · {timeAgo(selected.ts)}</span>
              </div>
              <dl className="lg-facts">
                <div><dt>Price</dt><dd className="num">{fmtPrice(selected.price)}</dd></div>
                <div><dt>Quantity</dt><dd className="num">{fmtQty(selected.qty)}</dd></div>
                <div><dt>Notional</dt><dd className="num">{fmtPrice(selected.quoteQty)}</dd></div>
                <div><dt>Fee</dt><dd className="num">{fmtQty(selected.commission)} {selected.commissionAsset ?? ''}</dd></div>
                <div><dt>Order id</dt><dd className="num">{selected.orderId ?? '—'}</dd></div>
                <div><dt>Source</dt><dd>{selected.source}</dd></div>
                <div><dt>Time</dt><dd>{fmtDateTime(selected.ts)}</dd></div>
              </dl>
              <div className="lg-related">
                <button className="hp-btn" type="button" onClick={() => openDetail(selected.symbol)}>Open market</button>
                <button className="hp-btn" type="button" onClick={() => setPage('pnl')}>PnL impact</button>
              </div>
            </>
          ) : null}
        </aside>}
      </div>
    </>
  );
}
