import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../styles.css';
import { buildStrategyDashboardFixture } from '../fixtures';
import { StrategyDashboard } from '../StrategyDashboard';
import type { StrategyDashboardEvidenceState } from '../types';
import './preview.css';

const FIXTURE_STATES = [
  'CURRENT',
  'PARTIAL',
  'STALE',
  'UNKNOWN',
  'UNAVAILABLE',
] as const satisfies readonly StrategyDashboardEvidenceState[];

function Preview() {
  const [state, setState] = useState<StrategyDashboardEvidenceState>('CURRENT');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const nowMs = useMemo(() => Date.now(), [state]);
  const fixture = useMemo(() => buildStrategyDashboardFixture(nowMs, state), [nowMs, state]);
  const viewportMode = new URLSearchParams(window.location.search).get('viewport');
  const compact = viewportMode === 'compact' || viewportMode === 'compact-320';

  document.documentElement.dataset.theme = theme;

  return (
    <div className={`strdp-shell${compact ? ' compact' : ''}${viewportMode === 'compact-320' ? ' compact-320' : ''}`}>
      <header className="strdp-harness">
        <span>
          <strong>SYNTHETIC PREVIEW · UNWIRED · NO PRODUCTION PnL</strong>
          <small>
            Fixture account values exist only on this preview route. Strategy performance remains UNKNOWN.
          </small>
        </span>
        <span className="strdp-controls" role="group" aria-label="Preview state">
          {FIXTURE_STATES.map((fixtureState) => (
            <button
              key={fixtureState}
              type="button"
              aria-pressed={state === fixtureState}
              onClick={() => setState(fixtureState)}
            >
              {fixtureState}
            </button>
          ))}
          <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </span>
      </header>
      <main className="strdp-viewport">
        <StrategyDashboard runtime={fixture.runtime} pnl={fixture.pnl} nowMs={nowMs} />
      </main>
    </div>
  );
}

const globalScope = globalThis as { __strategyDashboardPreviewRoot?: ReturnType<typeof createRoot> };
const root = globalScope.__strategyDashboardPreviewRoot ?? createRoot(document.getElementById('root')!);
globalScope.__strategyDashboardPreviewRoot = root;
root.render(<StrictMode><Preview /></StrictMode>);
