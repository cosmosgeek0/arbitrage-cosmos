/* Volume Scanner — honest placeholder in the Markets voice. The engine module
   (ENGINE.md §9) passed its synthetic proofs but is not wired to live streams,
   so this page states exactly what the scanner will report and nothing else.
   No fake rows, no simulated numbers, ever. */
import { useStore } from '../store';
import { Pill } from '../components/px';
import './Markets.css';

const SURFACE: { label: string; hint: string }[] = [
  { label: 'State', hint: 'Dead · waking · focus · proposal · rejected — the lifecycle the engine walks per symbol.' },
  { label: '1s Volume ×', hint: '1-second quote volume against the symbol’s own baseline.' },
  { label: '5s Volume ×', hint: '5-second confirmation window against baseline.' },
  { label: '1m Volume ×', hint: '1-minute volume against baseline — the slow confirmation.' },
  { label: 'Trades ×', hint: 'Trade-count spike versus the symbol’s norm.' },
  { label: 'Buy/Sell Aggression', hint: 'Taker imbalance — who is lifting, who is hitting.' },
  { label: 'Price Move', hint: 'Move since activation, the thing volume is supposed to predict.' },
  { label: 'Spread', hint: 'Current spread in bps — a spike into a wide book is not tradable.' },
  { label: 'Depth', hint: 'Book quality at the intended size.' },
  { label: 'Focus State', hint: 'Why the engine promoted the symbol to focus.' },
  { label: 'Reject Reason', hint: 'The named reason a candidate was dropped — never a silent drop.' },
];

export function VolumeScanner() {
  const { setPage } = useStore();

  return (
    <div className="container page mkx vsx-page">
      {/* ---- hero: the honest engine state -------------------------------- */}
      <header className="bwx-hero bsx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>Volume Scanner</h1>
              <Pill tone="idle">Not Wired</Pill>
            </div>
            <p>Quiet Symbols Waking Up — Volume Vs Baseline, Trade-Count Spikes, Taker Aggression · Engine Brain Merged, Live Streams Pending</p>
          </div>
        </div>
        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Engine Module</em>
            <b>88 / 88</b>
            <small>Synthetic Proofs Passed</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Live Adapters</em>
            <b>Pending</b>
            <small>Not Connected To Binance Streams</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Symbols Watched</em>
            <b>0</b>
            <small>Rows Appear Only From Real Decisions</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Proposals</em>
            <b>0</b>
            <small>Nothing Is Simulated</small>
          </div>
        </div>
      </header>

      {/* ---- the decision surface it will fill ----------------------------- */}
      <section className="rsx-band">
        <div className="bsx-props-head">
          <h2>Decision Surface <em>The Exact Fields The Scanner Will Report</em></h2>
          <button type="button" className="mkx-pill" onClick={() => setPage('strategies')}>Basis Scanner Is Live</button>
        </div>
        <div className="vsx-surface">
          {SURFACE.map((c) => (
            <div key={c.label} className="vsx-field">
              <b>{c.label}</b>
              <em>{c.hint}</em>
            </div>
          ))}
        </div>
        <p className="tdx-dimnote">
          The volume-spike module has not shipped its live adapters. This board fills only from real engine decisions — no data is faked, no rows are invented.
        </p>
      </section>
    </div>
  );
}
