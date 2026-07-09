/* Volume Scanner — honest placeholder in the Markets voice. The engine module
   (ENGINE.md §9) passed its synthetic proofs but is not wired to live streams,
   so this page states exactly what the scanner will report and nothing else.
   No fake rows, no simulated numbers, ever. */
import { useStore } from '../store';
import { Pill, type Tone } from '../components/px';
import './Markets.css';

type VolumeRow = { label: string; hint: string; value: string; tone?: Tone };

const WIRING: VolumeRow[] = [
  { label: 'Engine Module', hint: 'Synthetic proofs passed; the scanner brain is present.', value: '88 / 88', tone: 'ok' },
  { label: 'Stream Adapter', hint: 'No Binance stream is feeding this page yet.', value: 'pending', tone: 'idle' },
  { label: 'Live Symbols', hint: 'Rows appear only after real stream decisions arrive.', value: '0', tone: 'idle' },
  { label: 'Proposal Queue', hint: 'No volume proposal is staged right now.', value: '0', tone: 'idle' },
];

const SURFACE: VolumeRow[] = [
  { label: 'Lifecycle', hint: 'Dead -> Wake -> Focus -> Proposal -> Reject.', value: 'state' },
  { label: '1s Burst', hint: 'One-second quote volume against the symbol baseline.', value: '1s' },
  { label: '5s Confirm', hint: 'Five-second confirmation window against baseline.', value: '5s' },
  { label: '60s Hold', hint: 'One-minute volume check after activation.', value: '60s' },
  { label: 'Trade Count', hint: 'Print-count spike versus the symbol norm.', value: 'x' },
  { label: 'Taker Flow', hint: 'Buy/sell aggression from taker imbalance.', value: 'flow' },
  { label: 'Price Follow', hint: 'Move after activation, before any proposal.', value: 'move' },
  { label: 'Spread Guard', hint: 'Wide books reject the candidate before queueing.', value: 'bps' },
  { label: 'Depth Guard', hint: 'Top-book depth at the intended notional.', value: 'depth' },
  { label: 'Focus Reason', hint: 'Why the engine promoted the symbol.', value: 'reason' },
  { label: 'Reject Reason', hint: 'Named drop reason; no silent discard.', value: 'named' },
];

export function VolumeScanner() {
  const { setPage } = useStore();

  const VolumeStatusRow = ({ row }: { row: VolumeRow }) => (
    <div className="vsx-row">
      <i className={`vsx-dot ${row.tone ?? 'idle'}`} />
      <span className="vsx-main">
        <b>{row.label}</b>
        <em>{row.hint}</em>
      </span>
      <span className="vsx-value">{row.value}</span>
    </div>
  );

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
            <p>Quiet Symbols · Volume Burst · Taker Flow · Stream Adapter Pending</p>
          </div>
        </div>
        <div className="bwx-hero-metrics">
          <div className="bwx-hero-metric">
            <em>Proofs</em>
            <b>88 / 88</b>
            <small>Module ready</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Adapter</em>
            <b>Pending</b>
            <small>Binance stream not wired</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Live Symbols</em>
            <b>0</b>
            <small>Real rows only</small>
          </div>
          <div className="bwx-hero-metric">
            <em>Proposals</em>
            <b>0</b>
            <small>No simulated queue</small>
          </div>
        </div>
      </header>

      {/* ---- the decision surface it will fill ----------------------------- */}
      <section className="rsx-band">
        <div className="bsx-props-head">
          <h2>Live Wiring <em>Real State Only</em></h2>
          <button type="button" className="mkx-pill" onClick={() => setPage('strategies')}>Open Basis</button>
        </div>
        <div className="vsx-rows">
          {WIRING.map((row) => (
            <VolumeStatusRow key={row.label} row={row} />
          ))}
        </div>
      </section>

      <section className="rsx-band">
        <div className="bsx-props-head">
          <h2>Decision Fields <em>What The Scanner Will Report</em></h2>
        </div>
        <div className="vsx-rows two">
          {SURFACE.map((row) => (
            <VolumeStatusRow key={row.label} row={row} />
          ))}
        </div>
        <p className="tdx-dimnote">
          Live adapter pending. This board fills only from real engine decisions; no rows are invented.
        </p>
      </section>
    </div>
  );
}
