import { useStore } from '../store';
import { SetupChecklist } from '../components/ui';

export function Settings() {
  const { state } = useStore();
  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <b>Binance API keys</b>
        </div>
        <div className="conn-item" style={{ marginBottom: 10 }}>
          <span className={`dot ${state.binance.keysPresent ? 'dot-open' : 'dot-idle'}`} />
          {state.binance.keysPresent
            ? 'Keys are configured in the server environment. They are never shown here and never reach the browser.'
            : 'No keys configured.'}
        </div>
        <p className="muted small">
          There is deliberately no key input in this UI. Keys live in <span className="mono">.env</span> on the
          server (see <span className="mono">.env.example</span>) or in the process environment, and the server
          signs every request. To rotate keys: update <span className="mono">.env</span>, restart the service.
        </p>
        {!state.binance.keysPresent && <SetupChecklist />}
      </div>

      <div className="card">
        <div className="card-head">
          <b>Scanner parameters</b>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Threshold = est. fees {state.config.feesPct}% + required net edge {state.config.minNetBasisPct}% ={' '}
          <b>{state.scanner.grossThresholdPct.toFixed(2)}%</b> gross basis · persistence {state.config.persistTicks}{' '}
          ticks · min 24h volume ${(state.config.minQuoteVolume24h / 1e6).toFixed(0)}M. Edit trading limits on the
          Risk page; scanner parameters live in server config (Risk page saves both to the same ledgered config).
        </p>
        <div className="config-note muted small">
          All configuration persists in SQLite and every change is a <span className="mono">config_change</span>{' '}
          ledger event.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <b>About</b>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Cosmos Arbitrage Control Room v0 — private cockpit for one Binance account, behind Cloudflare Access.
          Live execution is manual-only: strategy proposals prefill a ticket; every send passes the server-side risk
          gate and a typed confirmation. No withdrawal or transfer code exists anywhere in this app. The full
          decision trail is on the Ledger page.
        </p>
        <div className="phase-tags">
          <span className="chip chip-gold">v0: shell + account + manual trade + risk + ledger</span>
          <span className="chip">next: testnet executor & two-leg basis tickets</span>
        </div>
      </div>
    </>
  );
}
