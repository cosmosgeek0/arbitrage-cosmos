import { useMemo } from 'react';
import { useStore } from '../store';
import { TokenIcon } from './TokenIcon';
import { Num } from './Num';
import { fmtPrice, fmtPct, signClass } from '../format';

/**
 * Slim live tape (marquee, pauses on hover). Watchlist first, then the most
 * liquid pairs. Every item is clickable and opens the token page.
 */
export function Tape() {
  const { markets, marketStatus, state, openDetail } = useStore();

  const items = useMemo(() => {
    // A global ticker has no room for a sufficiently explicit retained-data
    // receipt. Publish it only while the canonical market contract is current;
    // stale/unavailable rows remain available on their owned, labelled pages.
    if (marketStatus !== 'CURRENT' || markets.length === 0) return [];
    const watch = state?.config.watchlist ?? [];
    const seen = new Set<string>();
    const rows = [];
    for (const s of watch) {
      const r = markets.find((m) => m.symbol === s);
      if (r && !seen.has(r.symbol)) {
        rows.push(r);
        seen.add(r.symbol);
      }
    }
    for (const r of markets) {
      if (rows.length >= 14) break;
      if (!seen.has(r.symbol)) {
        rows.push(r);
        seen.add(r.symbol);
      }
    }
    return rows;
  }, [marketStatus, markets, state?.config.watchlist]);

  if (items.length === 0) return null;

  const strip = (keyPrefix: string) =>
    items.map((r) => (
      <button key={`${keyPrefix}-${r.symbol}`} className="tape-item" onClick={() => openDetail(r.symbol)}>
        <TokenIcon symbol={r.symbol} size={18} />
        <span className="tape-sym">{r.base}</span>
        <Num value={r.spot} className="tape-px">
          {fmtPrice(r.spot)}
        </Num>
        <span className={`tape-chg ${signClass(r.change24hPct)}`}>{fmtPct(r.change24hPct, 1)}</span>
      </button>
    ));

  return (
    <div className="tape">
      <div className="tape-track">
        {strip('a')}
        {strip('b')}
      </div>
    </div>
  );
}
