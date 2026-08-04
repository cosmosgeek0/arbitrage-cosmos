import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useRefreshSignal } from '../lib/refresh';
import { apiErrorMessage, fetchJson } from '../lib/http';
import { createSettledPoll, type SettledPoll } from '../lib/polling';
import { Empty, Pill, Seg } from '../components/px';
import { PillSelect } from '../components/PillSelect';
import { TokenIcon } from '../components/TokenIcon';
import { IconRefresh } from '../components/Icons';
import { baseOf, fmtDateTime, fmtMoney, fmtPrice, fmtQty, timeAgo } from '../format';
import type { FillRow } from '../types';

type SideFilter = 'ALL' | 'BUY' | 'SELL';
type SourceFilter = 'ALL' | string;

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
  const { state, openDetail, setPage, prefs } = useStore();
  const [fills, setFills] = useState<FillRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<SideFilter>('ALL');
  const [source, setSource] = useState<SourceFilter>('ALL');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const pollRef = useRef<SettledPoll | null>(null);

  useEffect(() => {
    const poll = createSettledPoll<FillRow[]>({
      intervalMs: Math.max(0.5, prefs.dataCadence?.account ?? 30) * 1_000,
      request: (signal) => {
        setLoading(true);
        return fetchJson('/api/fills', { signal });
      },
      onSuccess: (next) => {
        setFills(next);
        setLoadError(null);
        setLoading(false);
      },
      onError: (error) => {
        setLoadError(apiErrorMessage(error, 'Could not refresh fills from the local ledger.'));
        setLoading(false);
      },
    });
    pollRef.current = poll;
    poll.start();
    return () => {
      if (pollRef.current === poll) pollRef.current = null;
      poll.stop();
    };
  }, [state?.recentFills.length, prefs.dataCadence?.account]);
  useRefreshSignal(() => pollRef.current?.refresh());

  useEffect(() => {
    if (!selectedKey && fills && fills.length > 0) setSelectedKey(fillKey(fills[0]));
  }, [fills, selectedKey]);

  const rows = fills ?? [];
  const sources = useMemo(() => Array.from(new Set(rows.map((f) => f.source).filter(Boolean))).sort(), [rows]);
  const queryText = query.trim().toUpperCase();
  const filtered = useMemo(() => {
    return rows.filter((f) => {
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
  }, [rows, queryText, side, source]);

  const selected = filtered.find((f) => fillKey(f) === selectedKey) ?? filtered[0] ?? rows.find((f) => fillKey(f) === selectedKey) ?? rows[0] ?? null;
  const buyFills = rows.filter((f) => f.side === 'BUY');
  const sellFills = rows.filter((f) => f.side === 'SELL');
  const totalNotional = sum(rows.map((f) => f.quoteQty));
  const buyNotional = sum(buyFills.map((f) => f.quoteQty));
  const sellNotional = sum(sellFills.map((f) => f.quoteQty));
  const uniqueSymbols = new Set(rows.map((f) => f.symbol)).size;
  const lastTs = rows[0]?.ts ?? null;
  const ledgerReady = fills !== null;

  return (
    <>
      <div className="hp-stats exec-stats">
        <div className="hp-stat">
          <span className="k">Executed notional</span>
          <span className="v">{ledgerReady ? fmtMoney(totalNotional) : '—'}</span>
          <span className="s">{ledgerReady ? rows.length ? `${rows.length} fills · ${uniqueSymbols} symbols · last ${lastTs ? timeAgo(lastTs) : '—'}` : 'No durable fill evidence recorded' : loadError ? 'Local ledger unavailable' : 'Loading local ledger'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Buy / sell flow</span>
          <span className="v">{ledgerReady ? `${fmtMoney(buyNotional)} / ${fmtMoney(sellNotional)}` : '—'}</span>
          <span className="s">{ledgerReady ? `${buyFills.length} buys · ${sellFills.length} sells` : 'Unknown until the local ledger responds'}</span>
        </div>
        <div className="hp-stat">
          <span className="k">Commissions</span>
          <span className="v">{ledgerReady ? feeSummary(rows) : '—'}</span>
          <span className="s">Recorded evidence only · private import not configured</span>
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
          <PillSelect
            className="lg-select"
            value={source}
            options={[{ id: 'ALL', label: 'All sources' }, ...sources.map((s) => ({ id: s, label: s }))]}
            onChange={setSource}
            ariaLabel="Fill Source Filter"
            testId="fills-source-filter"
          />
        )}
        <button className="hp-btn" type="button" onClick={() => pollRef.current?.refresh()} disabled={loading}>
          <IconRefresh size={13} />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="hp-alert" role="alert" style={{ marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      <div className={`lg-grid exec-grid ${selected ? '' : 'solo'}`}>
        <section className="hp-group lg-feed" aria-label="Execution tape">
          <div className="lg-feed-head">
            <h3>Execution tape</h3>
            <span className="hp-val">{ledgerReady ? `${filtered.length} of ${rows.length} ledger fills` : 'Unknown · Local Ledger Unavailable'}</span>
          </div>
          {!ledgerReady || rows.length === 0 ? (
            <div className="lg-empty-pad">
              <Empty title={ledgerReady ? 'No Durable Fills Recorded' : 'Local Fill Evidence Is Unavailable'}>
                {ledgerReady
                  ? 'This read-only view shows only fills already present in the durable ledger. Private exchange import is NOT_CONFIGURED.'
                  : 'The app will not infer zero fills while the local ledger read is unavailable.'}
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
