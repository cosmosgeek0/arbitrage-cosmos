/* Settings is a local cockpit control surface: preferences apply immediately,
   trading limits remain on Risk, and Binance keys never enter the browser. */
import type { ReactNode } from 'react';
import { useStore } from '../store';
import {
  IconChart,
  IconClock,
  IconGrid,
  IconKeyboard,
  IconLayers,
  IconPercent,
  IconPulse,
  IconRefresh,
  IconShield,
} from '../components/Icons';
import { CURRENCIES, type Prefs } from '../lib/prefs';

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
  const { prefs, updatePref } = useStore();
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
            <RailItem href="#settings-local" icon={<IconGrid />} color="#111827" label="Local" active />
            <RailItem href="#settings-appearance" icon={<IconChart />} color="#8257e0" label="Appearance" />
            <RailItem href="#settings-data" icon={<IconClock />} color="#2a7de0" label="Data" />
            <RailItem href="#settings-about" icon={<IconShield />} color="#0a9b64" label="About" />
          </nav>
          <div className="settings-rail-status">
            <span className="mode-dot ok" />
            <b>Browser prefs</b>
            <em>local only</em>
          </div>
        </aside>

        <div className="settings-content-pane">
          <Section
            id="settings-local"
            title="Local preferences"
            note="This page changes how the cockpit is displayed in this browser."
          >
            <div className="settings-account-panel">
              <div className="settings-account-hero">
                <span className="settings-app-mark large" aria-hidden="true">
                  CA
                </span>
                <div>
                  <span className="settings-account-label">Browser-only settings</span>
                  <h1>Arbitrage Control Room</h1>
                  <p>Theme, density, motion, refresh cadence, display units, timezone, currency, and default page.</p>
                </div>
              </div>
              <div className="settings-boundary-note">
                <IconShield size={16} />
                <span>Keys are server-only. Account posture lives on Account; source health lives on Health.</span>
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
                icon={<IconGrid />}
                color="#111827"
                label="Currency"
                sub="Display currency for money values"
                control={
                  <Seg<string>
                    value={prefs.currency}
                    options={Object.keys(CURRENCIES).map((code) => ({ v: code, label: code }))}
                    onChange={(v) => updatePref('currency', v)}
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

          <Section id="settings-about" title="About" note="Scope of this settings surface.">
            <div className="settings-group">
              <div className="settings-row">
                <span className="sr-main">
                  <span className="sr-label">This browser</span>
                  <span className="sr-sub">{platform} · {zone} · {browser}</span>
                </span>
              </div>
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
