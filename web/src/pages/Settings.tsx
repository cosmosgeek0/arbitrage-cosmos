/* Settings is a local cockpit control surface: preferences apply immediately,
   trading limits remain on Risk, and Binance keys never enter the browser. */
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
  IconPercent,
  IconPulse,
  IconRefresh,
  IconShield,
} from '../components/Icons';
import type { Prefs } from '../lib/prefs';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

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
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)} type="button">
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

function ThemePreview({
  value,
  label,
  sub,
  active,
  onClick,
}: {
  value: Prefs['theme'];
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`settings-preview-card theme-${value} ${active ? 'active' : ''}`} onClick={onClick} type="button">
      <span className="settings-preview-frame" aria-hidden="true">
        <span className="preview-sidebar" />
        <span className="preview-window">
          <span className="preview-dot-row">
            <i />
            <i />
            <i />
          </span>
          <span className="preview-line wide" />
          <span className="preview-line" />
          <span className="preview-chart" />
        </span>
      </span>
      <span className="settings-preview-copy">
        <b>{label}</b>
        <em>{sub}</em>
      </span>
    </button>
  );
}

function DensityPreview({
  value,
  label,
  sub,
  active,
  onClick,
}: {
  value: Prefs['density'];
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  const rows = value === 'compact' ? 5 : 3;
  return (
    <button className={`settings-density-card ${value} ${active ? 'active' : ''}`} onClick={onClick} type="button">
      <span className="density-list" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i}>
            <i />
            <b />
            <em />
          </span>
        ))}
      </span>
      <span>
        <b>{label}</b>
        <em>{sub}</em>
      </span>
    </button>
  );
}

function RailItem({
  href,
  icon,
  label,
  color,
  active = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  color: string;
  active?: boolean;
}) {
  return (
    <a className={`settings-rail-item ${active ? 'active' : ''}`} href={href} aria-current={active ? 'true' : undefined}>
      <span className="sr-icon" style={{ background: color }}>
        {icon}
      </span>
      <span>{label}</span>
    </a>
  );
}

function FactRow({
  label,
  value,
  detail,
  tone,
  action,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: Tone;
  action?: ReactNode;
}) {
  return (
    <div className={`settings-fact-row ${tone ?? 'idle'}`}>
      <div className="settings-fact-copy">
        <span>{label}</span>
        <b>{value}</b>
        <em>{detail}</em>
      </div>
      {action && <div className="settings-fact-action">{action}</div>}
    </div>
  );
}

function DisabledReason({ children, reason }: { children: ReactNode; reason: string }) {
  return (
    <button className="mini-btn settings-disabled-control" type="button" disabled title={reason} aria-label={`${children}: ${reason}`}>
      {children}
    </button>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="settings-section" id={id}>
      <div className="settings-section-head">
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Settings() {
  const { state, prefs, updatePref, setPage } = useStore();
  const keysPresent = state?.binance.keysPresent ?? false;
  const connected = state?.binance.connected ?? false;
  const streamOpen = state?.binance.userStream === 'open';
  const canWithdraw = state?.binance.canWithdraw;
  const canTrade = state?.binance.canTrade;
  const keyPosture = keysPresent ? (connected ? 'Synced' : 'Keys set') : 'Read-only';
  const withdrawalCopy = canWithdraw === true ? 'Key permits withdrawals' : canWithdraw === false ? 'Disabled on key' : 'Blocked in app';
  const tradeCopy = canTrade === true ? 'Trading permission visible' : canTrade === false ? 'Read-only key' : 'Unknown until connected';
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || 'Desktop') : 'Desktop';
  const browser = typeof navigator !== 'undefined'
    ? (navigator.userAgent.match(/(Chrome|Firefox|Safari)\/([\d.]+)/)?.slice(1).join(' ') ?? 'Desktop browser')
    : 'Desktop browser';
  const zone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'local';

  return (
    <div className="container page settings-page">
      <section className="settings-shell" aria-label="Settings workbench">
        <aside className="settings-left-rail" aria-label="Settings sections">
          <div className="settings-identity">
            <span className="settings-app-mark" aria-hidden="true">
              CA
            </span>
            <b>Settings</b>
            <em>local cockpit controls</em>
          </div>
          <nav className="settings-rail-list">
            <RailItem href="#settings-account" icon={<IconGrid />} color="#111827" label="Account" active />
            <RailItem href="#settings-appearance" icon={<IconChart />} color="#8257e0" label="Appearance" />
            <RailItem href="#settings-data" icon={<IconClock />} color="#2a7de0" label="Data" />
            <RailItem href="#settings-safety" icon={<IconShield />} color="#0a9b64" label="Safety" />
          </nav>
          <div className="settings-rail-status">
            <span className={`mode-dot ${keysPresent ? (connected ? 'ok' : 'warn') : 'idle'}`} />
            <b>{keyPosture}</b>
            <em>{keysPresent ? 'server env only' : 'browser has no keys'}</em>
          </div>
        </aside>

        <div className="settings-content-pane">
          <Section
            id="settings-account"
            title="Account"
            note="One private Binance cockpit. Browser preferences are local; account and order truth stays server-side."
          >
            <div className="settings-account-panel">
              <div className="settings-account-hero">
                <span className="settings-app-mark large" aria-hidden="true">
                  CA
                </span>
                <div>
                  <span className="settings-account-label">Private Trading Cockpit</span>
                  <h1>Arbitrage Control Room</h1>
                  <p>Local interface controls for this browser. Live arming, risk limits, and kill switch remain on Risk.</p>
                </div>
              </div>
              <div className="settings-fact-list" aria-label="Current account posture">
                <FactRow
                  label="API keys"
                  value={keysPresent ? 'Server environment' : 'Not configured'}
                  detail={keysPresent ? 'Signed requests stay on the backend.' : 'Read-only market data; no key material in the browser.'}
                  tone={keysPresent ? 'ok' : 'idle'}
                />
                <FactRow
                  label="Account link"
                  value={connected ? 'Online' : keysPresent ? 'Waiting for sync' : 'Not linked'}
                  detail={connected ? 'Balances and account state are coming from Binance.' : 'The cockpit falls back to public data and safe empty states.'}
                  tone={connected ? 'ok' : keysPresent ? 'warn' : 'idle'}
                />
                <FactRow
                  label="User stream"
                  value={streamOpen ? 'Open' : 'Polling or closed'}
                  detail={streamOpen ? 'Private account events can arrive over the listen key.' : 'The server can still poll once keys exist.'}
                  tone={streamOpen ? 'ok' : 'idle'}
                />
                <FactRow
                  label="Active session"
                  value="This browser"
                  detail={`${platform} · ${zone} · ${browser}`}
                  tone="ok"
                />
                <FactRow
                  label="Withdrawal posture"
                  value={withdrawalCopy}
                  detail={canWithdraw === true ? 'Recreate the Binance key without withdrawal permission.' : 'No withdrawal or transfer-out UI exists here.'}
                  tone={canWithdraw === true ? 'bad' : 'ok'}
                />
              </div>
              <div className="settings-pane-actions">
                <button className="cta-pill" onClick={() => setPage('risk')} type="button">
                  Open Risk controls
                </button>
                <button className="mini-btn" onClick={() => setPage('system')} type="button">
                  View System Health
                </button>
              </div>
            </div>
          </Section>

          <Section
            id="settings-appearance"
            title="Appearance"
            note="Terminal chrome, motion, and density. These are local browser preferences."
          >
            <div className="settings-control-surface">
              <div className="settings-control-head">
                <span>
                  <b>Theme and density</b>
                  <em>Preview before changing theme. System follows the device theme.</em>
                </span>
                <span className="settings-current-pill">{prefs.theme}</span>
              </div>
              <div className="settings-preview-grid">
                <ThemePreview
                  value="light"
                  label="Clear"
                  sub="Bright trading desk"
                  active={prefs.theme === 'light'}
                  onClick={() => updatePref('theme', 'light')}
                />
                <ThemePreview
                  value="dark"
                  label="Graphite"
                  sub="Low-glare trading"
                  active={prefs.theme === 'dark'}
                  onClick={() => updatePref('theme', 'dark')}
                />
                <ThemePreview
                  value="system"
                  label="System"
                  sub="Device theme"
                  active={prefs.theme === 'system'}
                  onClick={() => updatePref('theme', 'system')}
                />
              </div>
              <div className="settings-density-grid">
                <DensityPreview
                  value="comfortable"
                  label="Comfortable"
                  sub="Readable review mode"
                  active={prefs.density === 'comfortable'}
                  onClick={() => updatePref('density', 'comfortable')}
                />
                <DensityPreview
                  value="compact"
                  label="Compact"
                  sub="Exchange-style density"
                  active={prefs.density === 'compact'}
                  onClick={() => updatePref('density', 'compact')}
                />
              </div>
            </div>
            <div className="settings-group">
              <Row
                icon={<IconPulse />}
                color="#e0568c"
                label="Motion"
                sub="Reduced disables draw-in, flash, and tape movement"
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
                sub="Also available as visual cards above"
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
                  <button className={`switch ${prefs.tape ? 'on' : ''}`} onClick={() => updatePref('tape', !prefs.tape)} aria-label="tape" type="button" />
                }
              />
            </div>
          </Section>

          <Section id="settings-data" title="Data and time" note="How market data and timestamps are presented in the cockpit.">
            <div className="settings-group">
              <Row
                icon={<IconRefresh />}
                color="#2a7de0"
                label="Markets refresh"
                sub="Poll rate for markets and tape data"
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
                    options={[{ v: 'dashboard', label: 'Dashboard' }, { v: 'markets', label: 'Markets' }, { v: 'trade', label: 'Execution' }]}
                    onChange={(v) => updatePref('defaultPage', v)}
                  />
                }
              />
              <Row
                icon={<IconKeyboard />}
                color="#697079"
                label="Keyboard"
                sub="Global command palette shortcuts are fixed in this build"
                control={<DisabledReason reason="Keyboard shortcut editing is not built; use Command-K, slash, and Escape.">Fixed</DisabledReason>}
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
                    type="button"
                  >
                    Reset
                  </button>
                }
              />
            </div>
          </Section>

          <Section id="settings-safety" title="API and safety" note="Server-only credentials, no withdrawal path, and visible risk posture.">
            <div className="settings-group">
              <Row
                icon={<IconKey />}
                color={keysPresent ? '#0a9b64' : '#697079'}
                label="Binance API key entry"
                sub={keysPresent ? 'Configured outside the browser. Rotate by updating the server environment and restarting.' : 'Disabled here by design. Add keys only on the server environment.'}
                control={
                  <DisabledReason reason="API keys are server-only and must never be typed into the browser.">
                    {keysPresent ? 'Server env' : 'Disabled'}
                  </DisabledReason>
                }
              />
            </div>
            {!keysPresent && (
              <div className="settings-setup-card">
                <SetupChecklist />
              </div>
            )}

            <div className="settings-posture-strip">
              <div>
                <span className="posture-medal ok">50</span>
                <b>Gate tests</b>
                <em>Required before done</em>
              </div>
              <div>
                <span className={`posture-medal ${keysPresent ? 'ok' : 'idle'}`}>{keysPresent ? 'ENV' : 'RO'}</span>
                <b>Key boundary</b>
                <em>Server-side only</em>
              </div>
              <div>
                <span className={`posture-medal ${canWithdraw === true ? 'bad' : 'ok'}`}>{canWithdraw === true ? '!' : '0'}</span>
                <b>Withdrawal paths</b>
                <em>{canWithdraw === true ? 'Key must be recreated' : 'UI/API blocked'}</em>
              </div>
            </div>
            <div className="settings-group">
              <Row
                icon={<IconShield />}
                color="#0a9b64"
                label="Active browser session"
                sub={`${platform} · ${zone} · ${browser}`}
                control={<span className="sr-value up">Active now</span>}
              />
              <Row
                icon={<IconPulse />}
                color="#697079"
                label="Suspicious sign-in alerts"
                sub="Delivery channel is not wired here yet; Cloudflare Access remains the upstream gate."
                control={<DisabledReason reason="Cockpit alert delivery is not built yet.">Not wired</DisabledReason>}
              />
              <Row
                icon={<IconKey />}
                color="#697079"
                label="Log out everywhere"
                sub="App-owned session revocation will live here once backend sessions exist."
                control={<DisabledReason reason="Session revocation is handled outside this app for now.">External gate</DisabledReason>}
              />
              {[
                { k: 'Keys never leave the server', v: 'Signed server-side; no key material in the browser or bundle', ok: true, status: keysPresent ? 'Server env' : 'Not set' },
                { k: 'No withdrawal code', v: 'No withdrawal or transfer-out method exists in the client or server', ok: true, status: 'Blocked' },
                {
                  k: 'Withdrawal permission on key',
                  v:
                    state?.binance.canWithdraw === true
                      ? 'ENABLED: recreate the key'
                      : state?.binance.canWithdraw === false
                        ? 'Disabled on the Binance side'
                        : 'Unknown until connected, blocked in app',
                  ok: state?.binance.canWithdraw !== true,
                  status: state?.binance.canWithdraw === true ? 'Recreate key' : state?.binance.canWithdraw === false ? 'Disabled' : 'Unknown',
                },
                { k: 'Trading permission', v: 'The app still requires Risk arming and typed confirmation before any live send', ok: canTrade !== false, status: tradeCopy },
                { k: 'Live sends', v: 'Kill switch + arm + allowlist + typed confirmation + server re-check', ok: true, status: 'Risk-gated' },
                { k: 'Access', v: 'Cloudflare Access in front of the private hostname', ok: true, status: 'External gate' },
                { k: 'Audit', v: 'Every decision, order, error, and config change is ledgered', ok: true, status: 'Ledgered' },
              ].map((r) => (
                <Row
                  key={r.k}
                  icon={<IconShield />}
                  color={r.ok ? '#0a9b64' : '#e0414b'}
                  label={r.k}
                  sub={r.v}
                  control={<span className={`sr-value ${r.ok ? 'up' : 'bad'}`}>{r.status}</span>}
                />
              ))}
              <Row
                icon={<IconShield />}
                color="#e0414b"
                label="Withdraw or transfer out"
                sub="Disabled with reason: this cockpit is allowed to view, propose, and risk-gate orders, never move funds out."
                control={<DisabledReason reason="Withdrawals and transfers out are forbidden in this app.">Unavailable</DisabledReason>}
              />
            </div>
          </Section>

          <Section id="settings-about" title="About" note="Scope of this settings surface.">
            <div className="settings-group">
              <div className="settings-row">
                <span className="sr-main">
                  <span className="sr-label">Control boundary</span>
                  <span className="sr-sub">
                    This page changes browser presentation only. Risk, live trading, kill switch, and execution rules
                    remain on server-backed surfaces.
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
          </Section>
        </div>
      </section>
    </div>
  );
}
