import { useMemo, type ReactNode } from 'react';
import {
  IconClock,
  IconCoins,
  IconGear,
  IconGrid,
  IconLayers,
  IconPercent,
  IconPulse,
  IconRefresh,
  IconShield,
  IconSun,
} from '../components/Icons';
import { useStore, type Page } from '../store';
import { CURRENCIES, type Prefs } from '../lib/prefs';

type Choice<T extends string | number> = {
  value: T;
  label: string;
};

const THEME_CHOICES: Choice<Prefs['theme']>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const MOTION_CHOICES: Choice<Prefs['motion']>[] = [
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
];

const TABLE_DENSITY_CHOICES: Choice<Prefs['density']>[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const BASIS_UNIT_CHOICES: Choice<Prefs['basisUnit']>[] = [
  { value: 'pct', label: 'Percent' },
  { value: 'bps', label: 'Basis points' },
];

const TIMEZONE_CHOICES: Choice<Prefs['timezone']>[] = [
  { value: 'local', label: 'Local' },
  { value: 'utc', label: 'UTC' },
];

const REFRESH_CHOICES: Choice<number>[] = [
  { value: 3, label: '3s' },
  { value: 6, label: '6s' },
  { value: 12, label: '12s' },
  { value: 30, label: '30s' },
];

const DENSITY_CHOICES: Array<Choice<'compact' | 'standard' | 'large'> & { zoom: number }> = [
  { value: 'compact', label: 'Compact', zoom: 0.95 },
  { value: 'standard', label: 'Standard', zoom: 1.05 },
  { value: 'large', label: 'Large', zoom: 1.15 },
];

const DEFAULT_PAGE_CHOICES: Choice<Page>[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'account', label: 'Account' },
  { value: 'markets', label: 'Markets' },
  { value: 'strategies', label: 'Basis scanner' },
  { value: 'opportunities', label: 'Opportunities' },
  { value: 'trade', label: 'Execution' },
  { value: 'settings', label: 'Settings' },
];

function densityValue(zoom: number): 'compact' | 'standard' | 'large' {
  if (zoom <= 0.99) return 'compact';
  if (zoom >= 1.1) return 'large';
  return 'standard';
}

function clearActivePage(): void {
  try {
    localStorage.removeItem('cosmos-active-page');
  } catch {
    // Ignore blocked storage. The pref itself still updates through the store.
  }
}

function resetLocalPreferences(): void {
  try {
    localStorage.removeItem('cosmos-prefs');
    localStorage.removeItem('cosmos-active-page');
    localStorage.removeItem('cosmos-detail-symbol');
  } catch {
    // Reload still restores in-memory defaults when storage is unavailable.
  }
  location.reload();
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  compact = false,
  ariaLabel,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  compact?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className={`settings-segment ${compact ? 'settings-segment-compact' : ''}`} aria-label={ariaLabel} role="group">
      {options.map((option) => (
        <button
          key={String(option.value)}
          className={`settings-choice ${Object.is(value, option.value) ? 'settings-choice-active' : ''}`}
          onClick={() => onChange(option.value)}
          aria-pressed={Object.is(value, option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group-block" aria-label={title}>
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-panel">{children}</div>
    </section>
  );
}

function SettingRow({
  icon,
  tone,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className={`settings-icon settings-icon-${tone}`} aria-hidden="true">
        {icon}
      </div>
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-detail">{detail}</div>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function Settings() {
  const { prefs, updatePref } = useStore();

  const currencyChoices = useMemo(
    () =>
      Object.entries(CURRENCIES).map(([code, currency]) => ({
        value: code,
        label: `${code} - ${currency.label}`,
      })),
    []
  );

  const currentDensity = densityValue(prefs.zoom || 1.05);
  const currentDefaultPage = DEFAULT_PAGE_CHOICES.some((choice) => choice.value === prefs.defaultPage)
    ? (prefs.defaultPage as Page)
    : 'dashboard';

  return (
    <div className="container page settings-page">
      <header className="settings-header">
        <h1 className="settings-title">Display</h1>
        <p className="settings-subtitle">
          Local browser preferences only. Keys are server-only; account posture lives on Account and source health lives
          on Health.
        </p>
      </header>

      <div className="settings-stack" aria-label="Local browser preferences">
        <SettingGroup title="Appearance">
          <SettingRow icon={<IconSun />} tone="theme" title="Theme" detail="Light, dark, or device setting.">
            <Segmented
              value={prefs.theme}
              options={THEME_CHOICES}
              ariaLabel="Theme"
              onChange={(value) => updatePref('theme', value)}
            />
          </SettingRow>

          <SettingRow icon={<IconGrid />} tone="density" title="Density" detail="Global cockpit scale for this browser.">
            <Segmented
              value={currentDensity}
              options={DENSITY_CHOICES}
              ariaLabel="Density"
              onChange={(value) => {
                const next = DENSITY_CHOICES.find((choice) => choice.value === value)?.zoom ?? 1.05;
                updatePref('zoom', next);
              }}
            />
          </SettingRow>

          <SettingRow icon={<IconPulse />} tone="motion" title="Motion" detail="Reduce animation when the cockpit should stay quiet.">
            <Segmented
              value={prefs.motion}
              options={MOTION_CHOICES}
              ariaLabel="Motion"
              onChange={(value) => updatePref('motion', value)}
            />
          </SettingRow>

          <SettingRow icon={<IconLayers />} tone="rows" title="Table density" detail="Row height for scanner, market, and log tables.">
            <Segmented
              value={prefs.density}
              options={TABLE_DENSITY_CHOICES}
              ariaLabel="Table density"
              onChange={(value) => updatePref('density', value)}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Market Display">
          <SettingRow icon={<IconRefresh />} tone="refresh" title="Refresh cadence" detail="Market and tape polling interval.">
            <Segmented
              value={prefs.refreshSec}
              options={REFRESH_CHOICES}
              ariaLabel="Refresh cadence"
              onChange={(value) => updatePref('refreshSec', value)}
              compact
            />
          </SettingRow>

          <SettingRow icon={<IconClock />} tone="time" title="Timezone" detail="Local time or UTC display.">
            <Segmented
              value={prefs.timezone}
              options={TIMEZONE_CHOICES}
              ariaLabel="Timezone"
              onChange={(value) => {
                updatePref('timezone', value);
                updatePref('clockZone', value === 'utc' ? 'UTC' : 'local');
              }}
            />
          </SettingRow>

          <SettingRow icon={<IconCoins />} tone="currency" title="Currency" detail="Fiat display for balances and PnL.">
            <select
              className="settings-select"
              aria-label="Currency"
              value={prefs.currency}
              onChange={(event) => updatePref('currency', event.target.value)}
            >
              {currencyChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow icon={<IconPercent />} tone="basis" title="Basis units" detail="Percent or basis points for spreads.">
            <Segmented
              value={prefs.basisUnit}
              options={BASIS_UNIT_CHOICES}
              ariaLabel="Basis units"
              onChange={(value) => updatePref('basisUnit', value)}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Startup">
          <SettingRow icon={<IconGear />} tone="startup" title="Default page" detail="First page after a fresh browser session.">
            <select
              className="settings-select settings-select-page"
              aria-label="Default page"
              value={currentDefaultPage}
              onChange={(event) => {
                updatePref('defaultPage', event.target.value);
                clearActivePage();
              }}
            >
              {DEFAULT_PAGE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Reset">
          <SettingRow icon={<IconShield />} tone="reset" title="Reset local preferences" detail="Restore browser display defaults. No server write.">
            <button className="settings-reset-button" type="button" onClick={resetLocalPreferences}>
              Reset
            </button>
          </SettingRow>
        </SettingGroup>
      </div>
    </div>
  );
}
