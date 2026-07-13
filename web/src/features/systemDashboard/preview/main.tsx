// Preview harness entry — UNWIRED. This page exists only to render the
// fixture-driven component library for design verification. It imports the
// app's global stylesheet for tokens, but registers no route and touches no
// store. Integration wiring is described in DASH_INTEGRATION_NOTES.md.

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  SystemControlMutation,
  SystemControlReceipt,
  SystemSupervisorSnapshot,
} from '../../../lib/systemIntegration';
import { FIXTURES, fixtureById } from '../fixtures';
import { applyFixtureMutation } from '../fixtures/mutator';
import { SystemDashboard } from '../SystemDashboard';
import '../../../styles.css';
import './harness.css';

const NO_SNAPSHOT_ID = 'no-snapshot';

function Harness() {
  const [fixtureId, setFixtureId] = useState<string>(FIXTURES[0].id);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [buildSeq, setBuildSeq] = useState(0);
  const [snapshot, setSnapshot] = useState<SystemSupervisorSnapshot | null>(() => FIXTURES[0].build(Date.now()));
  const [builtAtMs, setBuiltAtMs] = useState(() => Date.now());
  const [lastReceipt, setLastReceipt] = useState<SystemControlReceipt | null>(null);

  document.documentElement.dataset.theme = theme;

  const fixture = fixtureId === NO_SNAPSHOT_ID ? null : fixtureById(fixtureId);

  const selectFixture = (id: string) => {
    const now = Date.now();
    setFixtureId(id);
    setBuiltAtMs(now);
    setLastReceipt(null);
    setSnapshot(id === NO_SNAPSHOT_ID ? null : fixtureById(id).build(now));
    setBuildSeq((n) => n + 1);
  };

  const mutate = (mutation: SystemControlMutation, _reason: string) => {
    setSnapshot((current) => {
      if (!current) return current;
      const result = applyFixtureMutation(current, current.control.revision, mutation, Date.now());
      setLastReceipt(result.receipt);
      return result.snapshot;
    });
  };

  const description = useMemo(() => (
    fixture ? fixture.description : 'Null snapshot: the supervisor endpoint returned nothing. The surface must state UNAVAILABLE.'
  ), [fixture]);

  return (
    <div className="sdxh-shell">
      <div className="sdxh-bar" role="group" aria-label="Fixture harness">
        <div className="sdxh-identity">
          <strong>System Dashboard · Fixture Preview — SYNTHETIC DATA, UNWIRED</strong>
          <small>{description}</small>
        </div>
        <div className="sdxh-controls">
          {FIXTURES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === fixtureId ? 'selected' : ''}
              onClick={() => selectFixture(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            className={fixtureId === NO_SNAPSHOT_ID ? 'selected' : ''}
            onClick={() => selectFixture(NO_SNAPSHOT_ID)}
          >
            No Snapshot
          </button>
          <button type="button" onClick={() => selectFixture(fixtureId)}>Rebuild</button>
          <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
      <p className="sdxh-note">
        Controls below fire in fixture mode only: mutations apply to the in-memory snapshot and the
        receipt reports FIXTURE_APPLIED with no ledger event. No network request leaves this page.
      </p>
      <SystemDashboard
        key={`${fixtureId}-${buildSeq}`}
        snapshot={snapshot}
        nowMs={builtAtMs}
        mutate={mutate}
        lastReceipt={lastReceipt}
        busy={false}
        unavailableReason={fixtureId === NO_SNAPSHOT_ID ? 'Fixture harness: no snapshot supplied — this is the honest empty state.' : null}
      />
    </div>
  );
}

// Vite HMR re-executes this entry module; reuse the existing root so React
// does not warn about a second createRoot on the same container.
const globalScope = globalThis as { __sdxPreviewRoot?: ReturnType<typeof createRoot> };
const root = globalScope.__sdxPreviewRoot ?? createRoot(document.getElementById('root')!);
globalScope.__sdxPreviewRoot = root;
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
