import { useMemo, type ReactNode } from 'react';
import { useStore, type Page } from '../store';
import {
  IconChart,
  IconClock,
  IconGrid,
  IconLayers,
  IconPercent,
  IconPulse,
  IconRefresh,
} from '../components/Icons';
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
  { value: 'pct', label: '%' },
  { value: 'bps', label: 'bps' },
];

const TIMEZONE_CHOICES: Choice<Prefs['timezone']>[] = [
  { value: 'local', label: 'Local' },
  { value: 'utc', label: 'UTC' },
];

const REFRESH_CHOICES: Choice<number>[] = [
  { value: 3, label: '3s' },
  { value: 6, label: '6s' },
  { value: 12, label: '12s' },
];

const INTERFACE_SIZE_CHOICES: Array<Choice<'compact' | 'standard' | 'large'> & { zoom: number }> = [
  { value: 'compact', label: 'Compact', zoom: 0.95 },
  { value: 'standard', label: 'Standard', zoom: 1.05 },
  { value: 'large', label: 'Large', zoom: 1.15 },
];

const STARTUP_PAGE_CHOICES: Choice<Page>[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'markets', label: 'Markets' },
  { value: 'trade', label: 'Execution' },
];

function interfaceSizeValue(zoom: number): 'compact' | 'standard' | 'large' {
  if (zoom <= 0.99) return 'compact';
  if (zoom >= 1.1) return 'large';
  return 'standard';
}

function clearActivePage(): void {
  try {
    localStorage.removeItem('cosmos-active-page');
  } catch {
    // Browser storage can be blocked; the preference still updates in memory.
  }
}

function resetLocalPreferences(): void {
  try {
    localStorage.removeItem('cosmos-prefs');
    localStorage.removeItem('cosmos-active-page');
    localStorage.removeItem('cosmos-detail-symbol');
  } catch {
    // Reload restores defaults even when storage removal is blocked.
  }
  location.reload();
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  wide = false,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  wide?: boolean;
}) {
  return (
    <div className={`settings-segment ${wide ? 'settings-segment-wide' : ''}`} role="group" aria-label={ariaLabel}>
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
  sub: string;
  control: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="sr-icon" style={{ background: color }} aria-hidden="true">
        {icon}
      </span>
      <span className="sr-main">
        <span className="sr-label">{label}</span>
        <span className="sr-sub">{sub}</span>
      </span>
      <span className="sr-ctl">{control}</span>
    </div>
  );
}

export function Settings() {
  const { prefs, updatePref } = useStore();
  const currencyChoices = useMemo(
    () => Object.keys(CURRENCIES).map((code) => ({ value: code, label: code })),
    []
  );
  const currentInterfaceSize = interfaceSizeValue(prefs.zoom || 1.05);
  const currentDefaultPage = STARTUP_PAGE_CHOICES.some((choice) => choice.value === prefs.defaultPage)
    ? (prefs.defaultPage as Page)
    : 'dashboard';

  return (
    <div className="container page settings-page">
      <div className="settings-content-pane" aria-label="Local browser preferences">
        <div className="settings-group settings-single-box">
          <Row
            icon={<IconChart />}
            color="#2a7de0"
            label="Theme"
            sub="Light, dark, or device setting"
            control={
              <Segmented
                value={prefs.theme}
                options={THEME_CHOICES}
                ariaLabel="Theme"
                onChange={(value) => updatePref('theme', value)}
              />
            }
          />
          <Row
            icon={<IconGrid />}
            color="#8257e0"
            label="Interface size"
            sub="Global cockpit scale for this browser"
            control={
              <Segmented
                value={currentInterfaceSize}
                options={INTERFACE_SIZE_CHOICES}
                ariaLabel="Interface size"
                onChange={(value) => {
                  const next = INTERFACE_SIZE_CHOICES.find((choice) => choice.value === value)?.zoom ?? 1.05;
                  updatePref('zoom', next);
                }}
              />
            }
          />
          <Row
            icon={<IconPulse />}
            color="#e0568c"
            label="Motion"
            sub="Reduced disables draw-in, flash, and tape movement"
            control={
              <Segmented
                value={prefs.motion}
                options={MOTION_CHOICES}
                ariaLabel="Motion"
                onChange={(value) => updatePref('motion', value)}
              />
            }
          />
          <Row
            icon={<IconLayers />}
            color="#0aa5a5"
            label="Table density"
            sub="Row height for scanner, market, and log tables"
            control={
              <Segmented
                value={prefs.density}
                options={TABLE_DENSITY_CHOICES}
                ariaLabel="Table density"
                onChange={(value) => updatePref('density', value)}
              />
            }
          />
          <Row
            icon={<IconRefresh />}
            color="#2a7de0"
            label="Markets refresh"
            sub="Poll rate for markets and tape data"
            control={
              <Segmented
                value={prefs.refreshSec}
                options={REFRESH_CHOICES}
                ariaLabel="Markets refresh"
                onChange={(value) => updatePref('refreshSec', value)}
              />
            }
          />
          <Row
            icon={<IconClock />}
            color="#697079"
            label="Timestamps"
            sub="Engine always logs UTC internally"
            control={
              <Segmented
                value={prefs.timezone}
                options={TIMEZONE_CHOICES}
                ariaLabel="Timestamps"
                onChange={(value) => {
                  updatePref('timezone', value);
                  updatePref('clockZone', value === 'utc' ? 'UTC' : 'local');
                }}
              />
            }
          />
          <Row
            icon={<IconGrid />}
            color="#111827"
            label="Currency"
            sub="Display currency for money values"
            control={
              <Segmented
                value={prefs.currency}
                options={currencyChoices}
                ariaLabel="Currency"
                onChange={(value) => updatePref('currency', value)}
                wide
              />
            }
          />
          <Row
            icon={<IconPercent />}
            color="#0a9b64"
            label="Basis units"
            sub="Percent or basis points, everywhere basis is shown"
            control={
              <Segmented
                value={prefs.basisUnit}
                options={BASIS_UNIT_CHOICES}
                ariaLabel="Basis units"
                onChange={(value) => updatePref('basisUnit', value)}
              />
            }
          />
          <Row
            icon={<IconGrid />}
            color="#8257e0"
            label="Default page"
            sub="Where the app opens"
            control={
              <Segmented
                value={currentDefaultPage}
                options={STARTUP_PAGE_CHOICES}
                ariaLabel="Default page"
                onChange={(value) => {
                  updatePref('defaultPage', value);
                  clearActivePage();
                }}
                wide
              />
            }
          />
          <Row
            icon={<IconRefresh />}
            color="#e0414b"
            label="Reset preferences"
            sub="Clears local UI prefs only, never trading config"
            control={
              <button className="settings-reset-button" type="button" onClick={resetLocalPreferences}>
                Reset
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
