import { useStore } from '../store';
import { IconPulse, IconShield } from '../components/Icons';

// Volume Spike Scanner — honest placeholder. The engine module (ENGINE.md §9,
// build order Part 11) is not implemented yet, so this page shows the exact
// decision surface it will fill and nothing else. No fake engine, no fake rows.
const COLUMNS = [
  { key: 'state', label: 'State', hint: 'dead · waking · focus · proposal · rejected' },
  { key: 'symbol', label: 'Symbol', hint: 'USDT pair under watch' },
  { key: 'v1', label: '1s vol ×', hint: '1-second quote volume vs own baseline' },
  { key: 'v5', label: '5s vol ×', hint: '5-second confirmation vs baseline' },
  { key: 'v60', label: '1m vol ×', hint: '1-minute volume vs baseline' },
  { key: 'trades', label: 'Trades ×', hint: 'trade-count spike vs norm' },
  { key: 'aggr', label: 'Buy/sell', hint: 'taker aggression imbalance' },
  { key: 'move', label: 'Price move', hint: 'move since activation' },
  { key: 'spread', label: 'Spread', hint: 'current spread bps' },
  { key: 'depth', label: 'Depth', hint: 'book quality at intended size' },
  { key: 'reason', label: 'Reason', hint: 'focus reason or named reject reason' },
];

export function VolumeScanner() {
  const { setPage } = useStore();

  return (
    <div className="container page volume-page">
      <div className="page-head">
        <div>
          <div className="page-kicker">Engine · scanner</div>
          <h1 className="page-title">Volume Scanner</h1>
          <div className="page-sub">
            Detects quiet symbols waking up — volume vs own baseline, trade-count spikes, taker aggression —
            then focuses, verifies, and proposes. Rejections are shown with named reasons.
          </div>
        </div>
      </div>

      <section className="card vol-setup-card">
        <div className="vol-setup">
          <span className="vol-setup-icon"><IconPulse size={18} /></span>
          <div className="vol-setup-copy">
            <b>Engine module not built yet</b>
            <span>
              This is Engine v0 · Part 11 (after rolling windows, focus manager, and the basis scanner).
              Nothing here is simulated — the table below fills only when the real module ships.
            </span>
          </div>
          <button className="mini-btn" type="button" onClick={() => setPage('strategies')}>
            <IconShield size={14} />
            Basis Scanner (live)
          </button>
        </div>
      </section>

      <section className="card vol-board-card">
        <div className="vol-board-head">
          <h2>Decision board</h2>
          <span>The exact fields the scanner will report per symbol.</span>
        </div>
        <div className="vol-board-cols" role="row">
          {COLUMNS.map((c) => (
            <span key={c.key} className="vol-col" title={c.hint}>{c.label}</span>
          ))}
        </div>
        <div className="vol-board-empty">
          No engine output — the volume-spike module has not shipped. No data is faked.
        </div>
      </section>
    </div>
  );
}
