import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag } from '../components/ui';
import { TokenIcon } from '../components/TokenIcon';
import { fmtPrice, fmtQty, fmtDateTime } from '../format';
import type { FillRow } from '../types';

export function Fills() {
  const { state, importFills } = useStore();
  const [fills, setFills] = useState<FillRow[]>([]);
  const [importSymbol, setImportSymbol] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = () =>
    fetch('/api/fills')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setFills(d as FillRow[]))
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, [state?.recentFills.length]);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Fills</h1>
          <div className="page-sub">Every execution, live from the stream — the ledger is the source of truth</div>
        </div>
        <div className="head-actions">
          <div className="tsearch">
            <input
              placeholder="Symbol e.g. BTCUSDT"
              value={importSymbol}
              onChange={(e) => setImportSymbol(e.target.value.toUpperCase())}
              spellCheck={false}
            />
          </div>
          <button
            className="mini-btn"
            disabled={!state?.binance.keysPresent || importSymbol.length < 5}
            onClick={async () => {
              const res = await importFills(importSymbol);
              setImportMsg(res.error ? `Import failed: ${res.error}` : `Imported ${res.imported} new fills for ${importSymbol}`);
              void load();
            }}
          >
            Import history
          </button>
        </div>
      </div>

      {importMsg && <div className="result-strip ok">{importMsg}</div>}

      {fills.length === 0 ? (
        <EmptyState title="No fills in the ledger">
          Fills stream in live once connected. Use “Import history” with a symbol to pull past trades from Binance.
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="mkt dense">
            <thead>
              <tr>
                <th className="l">Time</th>
                <th className="l">Symbol</th>
                <th className="l">Side</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Value</th>
                <th>Fee</th>
                <th className="l">Source</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f) => (
                <tr key={`${f.symbol}-${f.tradeId}`}>
                  <td className="l muted">{fmtDateTime(f.ts)}</td>
                  <td className="l">
                    <span className="tok">
                      <TokenIcon symbol={f.symbol} size={24} />
                      <span className="tok-name">{f.symbol}</span>
                    </span>
                  </td>
                  <td className="l">
                    <SideTag side={f.side} />
                  </td>
                  <td>
                    <span className="num">{fmtPrice(f.price)}</span>
                  </td>
                  <td>
                    <span className="num">{fmtQty(f.qty)}</span>
                  </td>
                  <td className="val-strong">
                    <span className="num">{fmtPrice(f.quoteQty)}</span>
                  </td>
                  <td className="muted">
                    <span className="num">
                      {f.commission} {f.commissionAsset ?? ''}
                    </span>
                  </td>
                  <td className="l muted">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
