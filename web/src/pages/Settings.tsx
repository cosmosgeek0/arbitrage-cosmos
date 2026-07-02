import type { ReactNode } from 'react';
import { useStore } from '../store';
import { SetupChecklist } from '../components/ui';
import {
  IconChart,
  IconClock,
  IconGrid,
  IconKey,
  IconKeyboard,
  IconLayers,
  IconMoon,
  IconPercent,
  IconPulse,
  IconRefresh,
  IconShield,
} from '../components/Icons';
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

function Row({
  icon,
  color,
  label,
  sub,
  control,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  sub?: string;
  control: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="sr-icon" style={{ background: color }}>
        {icon}
      </span>
      <span className="sr-main">
        <span className="sr-label">{label}</span>
        {sub && <span className="sr-sub">{sub}</span>}
      </span>
      <span className="sr-ctl">{control}</span>
    </div>
  );
}

export function Settings() {
  const { state, prefs, updatePref } = useStore();
  const keysPresent = state?.binance.keysPresent ?? false;

  return (
    <div className="container page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">UI preferences persist in this browser · trading config lives on the Risk page</div>
        </div>
      </div>

      <div className="settings-sec">Appearance</div>
      <div className="settings-group">
        <Row
          icon={<IconMoon />}
          color="#5b5bd6"
          label="Theme"
          sub="System follows your OS"
          control={
            <Seg<Prefs['theme']>
              value={prefs.theme}
              options={[{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }]}
              onChange={(v) => updatePref('theme', v)}
            />
          }
        />
        <Row
          icon={<IconPulse />}
          color="#e0568c"
          label="Motion"
          sub="Reduced kills animations and the tape marquee"
          control={
            <Seg<Prefs['motion']>
              value={prefs.motion}
              options={[{ v: 'full', label: 'Full' }, { v: 'reduced', label: 'Reduced' }]}
              onChange={(v) => updatePref('motion', v)}
            />
          }
        />
        <Row
          icon={<IconLayers />}
          color="#0aa5a5"
          label="Table density"
          sub="Row height in data tables"
          control={
            <Seg<Prefs['density']>
              value={prefs.density}
              options={[{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }]}
              onChange={(v) => updatePref('density', v)}
            />
          }
        />
        <Row
          icon={<IconChart />}
          color="#e08a2a"
          label="Ticker tape"
          sub="Small optional price tape under the top bar"
          control={
            <button className={`switch ${prefs.tape ? 'on' : ''}`} onClick={() => updatePref('tape', !prefs.tape)} aria-label="tape" />
          }
        />
      </div>

      <div className="settings-sec">Data &amp; time</div>
      <div className="settings-group">
        <Row
          icon={<IconRefresh />}
          color="#2a7de0"
          label="Markets refresh"
          sub="Poll rate for the markets / tape data"
          control={
            <Seg
              value={String(prefs.refreshSec)}
              options={[{ v: '3', label: '3s' }, { v: '6', label: '6s' }, { v: '12', label: '12s' }]}
              onChange={(v) => updatePref('refreshSec', Number(v))}
            />
          }
        />
        <Row
          icon={<IconClock />}
          color="#697079"
          label="Timestamps"
          sub="Engine always logs UTC internally"
          control={
            <Seg<Prefs['timezone']>
              value={prefs.timezone}
              options={[{ v: 'local', label: 'Local' }, { v: 'utc', label: 'UTC' }]}
              onChange={(v) => updatePref('timezone', v)}
            />
          }
        />
        <Row
          icon={<IconPercent />}
          color="#0a9b64"
          label="Basis units"
          sub="Percent or basis points, everywhere basis is shown"
          control={
            <Seg<Prefs['basisUnit']>
              value={prefs.basisUnit}
              options={[{ v: 'pct', label: '%' }, { v: 'bps', label: 'bps' }]}
              onChange={(v) => updatePref('basisUnit', v)}
            />
          }
        />
        <Row
          icon={<IconGrid />}
          color="#8257e0"
          label="Default page"
          sub="Where the app opens"
          control={
            <Seg
              value={prefs.defaultPage}
              options={[{ v: 'dashboard', label: 'Dashboard' }, { v: 'markets', label: 'Markets' }, { v: 'trade', label: 'Trade' }]}
              onChange={(v) => updatePref('defaultPage', v)}
            />
          }
        />
        <Row
          icon={<IconKeyboard />}
          color="#697079"
          label="Keyboard"
          control={<span className="sr-value">⌘K / “/” search · Esc closes</span>}
        />
        <Row
          icon={<IconRefresh />}
          color="#e0414b"
          label="Reset preferences"
          sub="Clears local UI prefs only, never trading config"
          control={
            <button
              className="mini-btn"
              onClick={() => {
                localStorage.removeItem('cosmos-prefs');
                location.reload();
              }}
            >
              Reset
            </button>
          }
        />
      </div>

      <div className="settings-sec">Binance API keys</div>
      <div className="settings-group">
        <Row
          icon={<IconKey />}
          color={keysPresent ? '#0a9b64' : '#697079'}
          label={keysPresent ? 'Configured in server environment' : 'Not configured'}
          sub="No key input here — keys live in .env on the server, the browser never sees them. Rotate by updating .env and restarting."
          control={<span className={`sr-value ${keysPresent ? 'up' : ''}`}>{keysPresent ? 'connected' : 'absent'}</span>}
        />
      </div>
      {!keysPresent && (
        <div className="card" style={{ marginTop: 10 }}>
          <SetupChecklist />
        </div>
      )}

      <div className="settings-sec">Security posture</div>
      <div className="settings-group">
        {[
          { k: 'Keys never leave the server', v: 'Signed server-side; no key material in the browser or bundle', ok: true },
          { k: 'No withdrawal code', v: 'No withdrawal/transfer method exists in the client or server', ok: true },
          {
            k: 'Withdrawal permission on key',
            v:
              state?.binance.canWithdraw === true
                ? 'ENABLED — recreate the key!'
                : state?.binance.canWithdraw === false
                  ? 'Disabled on the Binance side'
                  : 'Unknown until connected',
            ok: state?.binance.canWithdraw !== true,
          },
          { k: 'Live sends', v: 'Kill switch + arm + allowlist + typed confirmation + server re-check', ok: true },
          { k: 'Access', v: 'Cloudflare Access (YubiKey + email) in front of the tunnel', ok: true },
          { k: 'Audit', v: 'Every decision, order, error and config change is ledgered', ok: true },
        ].map((r) => (
          <Row
            key={r.k}
            icon={<IconShield />}
            color={r.ok ? '#0a9b64' : '#e0414b'}
            label={r.k}
            sub={r.v}
            control={<span className="sr-check" style={{ background: r.ok ? 'var(--up)' : 'var(--down)' }}>{r.ok ? '✓' : '✗'}</span>}
          />
        ))}
      </div>

      <div className="settings-sec">About</div>
      <div className="settings-group">
        <div className="settings-row">
          <span className="sr-main">
            <span className="sr-label">Cosmos Arbitrage Control Room</span>
            <span className="sr-sub" style={{ lineHeight: 1.6 }}>
              Private cockpit for one Binance account behind Cloudflare Access. Live execution is manual-only:
              strategies propose, you approve, the server-side risk gate decides, a typed confirmation sends. Loans
              follow the same gate. No withdrawal or transfer code exists anywhere. Every decision is on the Ledger.
            </span>
          </span>
        </div>
        <div className="settings-row">
          <span className="sr-main">
            <span className="sr-label">Version</span>
          </span>
          <span className="sr-ctl">
            <span className="chip-tag gold">v2 · cockpit + markets + loans + margin</span>
          </span>
        </div>
      </div>
    </div>
  );
}
