import { useStore } from '../store';
import { SetupChecklist, StatusDot } from '../components/ui';
import type { Prefs } from '../lib/prefs';

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Settings() {
  const { state, prefs, updatePref } = useStore();

  const row = (k: string, sub: string | null, control: JSX.Element) => (
    <div className="xrow" key={k}>
      <span>
        <div className="k">{k}</div>
        {sub && <div className="t">{sub}</div>}
      </span>
      <span className="v">{control}</span>
    </div>
  );

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">UI preferences persist in this browser · trading config lives on the Risk page</div>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec-title">Appearance</h2>
      </div>
      {row('Theme', 'system follows your OS', (
        <Seg<Prefs['theme']>
          value={prefs.theme}
          options={[{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }]}
          onChange={(v) => updatePref('theme', v)}
        />
      ))}
      {row('Motion', 'reduced kills animations and the tape marquee', (
        <Seg<Prefs['motion']>
          value={prefs.motion}
          options={[{ v: 'full', label: 'Full' }, { v: 'reduced', label: 'Reduced' }]}
          onChange={(v) => updatePref('motion', v)}
        />
      ))}
      {row('Table density', null, (
        <Seg<Prefs['density']>
          value={prefs.density}
          options={[{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }]}
          onChange={(v) => updatePref('density', v)}
        />
      ))}
      {row('Ticker tape', 'small optional price tape under the top bar', (
        <button className={`switch ${prefs.tape ? 'on' : ''}`} onClick={() => updatePref('tape', !prefs.tape)} aria-label="tape" />
      ))}

      <div className="sec-head">
        <h2 className="sec-title">Data &amp; time</h2>
      </div>
      {row('Markets refresh', 'poll rate for the markets/tape data', (
        <Seg
          value={String(prefs.refreshSec)}
          options={[{ v: '3', label: '3s' }, { v: '6', label: '6s' }, { v: '12', label: '12s' }]}
          onChange={(v) => updatePref('refreshSec', Number(v))}
        />
      ))}
      {row('Timestamps', 'engine always logs UTC internally', (
        <Seg<Prefs['timezone']>
          value={prefs.timezone}
          options={[{ v: 'local', label: 'Local' }, { v: 'utc', label: 'UTC' }]}
          onChange={(v) => updatePref('timezone', v)}
        />
      ))}
      {row('Basis units', 'percent or basis points, everywhere basis is shown', (
        <Seg<Prefs['basisUnit']>
          value={prefs.basisUnit}
          options={[{ v: 'pct', label: '%' }, { v: 'bps', label: 'bps' }]}
          onChange={(v) => updatePref('basisUnit', v)}
        />
      ))}
      {row('Default page', 'where the app opens', (
        <Seg
          value={prefs.defaultPage}
          options={[{ v: 'dashboard', label: 'Dashboard' }, { v: 'markets', label: 'Markets' }, { v: 'trade', label: 'Trade' }]}
          onChange={(v) => updatePref('defaultPage', v)}
        />
      ))}
      {row('Keyboard', null, <span className="muted small">⌘K / “/” search · Esc closes overlays</span>)}
      {row('Reset preferences', 'clears local UI prefs only, never trading config', (
        <button
          className="mini-btn"
          onClick={() => {
            localStorage.removeItem('cosmos-prefs');
            location.reload();
          }}
        >
          Reset
        </button>
      ))}

      <div className="sec-head">
        <h2 className="sec-title">Binance API keys</h2>
      </div>
      <div className="xrow">
        <StatusDot status={state?.binance.keysPresent ? 'live' : 'none'} />
        <span>
          <div className="k">{state?.binance.keysPresent ? 'Configured in server environment' : 'Not configured'}</div>
          <div className="t">
            Deliberately no key input here — keys live in .env on the server, the browser never sees them. Rotate by
            updating .env and restarting.
          </div>
        </span>
      </div>
      {!state?.binance.keysPresent && <SetupChecklist />}

      <div className="sec-head">
        <h2 className="sec-title">Security posture</h2>
      </div>
      {[
        { k: 'Keys never leave the server', v: 'signed server-side; no key material in the browser or bundle', ok: true },
        { k: 'No withdrawal code', v: 'no withdrawal/transfer method exists in the client or server', ok: true },
        { k: 'Withdrawal permission on key', v: state?.binance.canWithdraw === true ? 'ENABLED — recreate the key!' : state?.binance.canWithdraw === false ? 'disabled on Binance side' : 'unknown until connected', ok: state?.binance.canWithdraw !== true },
        { k: 'Live sends', v: 'kill switch + arm + allowlist + typed confirmation + server re-check', ok: true },
        { k: 'Access', v: 'Cloudflare Access (YubiKey + email) in front of the tunnel', ok: true },
        { k: 'Audit', v: 'every decision, order, error and config change is ledgered', ok: true },
      ].map((r) => (
        <div key={r.k} className="xrow">
          <span className={r.ok ? 'up' : 'down'} style={{ fontWeight: 800, width: 14 }}>
            {r.ok ? '✓' : '✗'}
          </span>
          <span>
            <div className="k">{r.k}</div>
            <div className="t">{r.v}</div>
          </span>
        </div>
      ))}

      <div className="sec-head">
        <h2 className="sec-title">About</h2>
      </div>
      <p className="muted" style={{ lineHeight: 1.65, maxWidth: 760, marginTop: 0 }}>
        Cosmos Arbitrage Control Room — private cockpit for one Binance account behind Cloudflare Access. Live
        execution is manual-only: strategies propose, you approve, the server-side risk gate decides, a typed
        confirmation sends. Loans follow the same gate. No withdrawal or transfer code exists anywhere. Every
        decision is on the Ledger page.
      </p>
      <div className="chips">
        <span className="chip-tag gold">v1.1 · cockpit + markets + loans + margin + system health</span>
        <span className="chip-tag">next: two-leg basis ticket via testnet</span>
      </div>
    </div>
  );
}
