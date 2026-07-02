import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { EmptyState, SideTag } from '../components/ui';
import { fmtPrice, fmtDateTime } from '../format';
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
    <div className="card table-card">
      <div className="card-head">
        <b>Fills</b>
        <div className="import-box">
          <input
            placeholder="Symbol e.g. BTCUSDT"
            value={importSymbol}
            onChange={(e) => setImportSymbol(e.target.value.toUpperCase())}
            spellCheck={false}
          />
          <button
            className="btn btn-ghost btn-sm"
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
      {importMsg && <div className="result-banner ok">{importMsg}</div>}
      {fills.length === 0 ? (
        <EmptyState title="No fills in the ledger">
          Fills stream in live once connected. Use “Import history” with a symbol to pull past trades from Binance.
        </EmptyState>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Value</th>
              <th>Fee</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((f) => (
              <tr key={`${f.symbol}-${f.tradeId}`}>
                <td className="muted small">{fmtDateTime(f.ts)}</td>
                <td className="strong">{f.symbol}</td>
                <td>
                  <SideTag side={f.side} />
                </td>
                <td className="num">{fmtPrice(f.price)}</td>
                <td className="num">{f.qty}</td>
                <td className="num">{fmtPrice(f.quoteQty)}</td>
                <td className="num muted small">
                  {f.commission} {f.commissionAsset ?? ''}
                </td>
                <td className="muted small">{f.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
