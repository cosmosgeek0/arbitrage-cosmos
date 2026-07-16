import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { REQUIRED_FIXTURE_SCENARIOS, type ProductFixtureScenarioId } from '../../../lib/productIntegration';
import { FixtureProductControlRoom } from '../ProductControlRoom';
import '../../../styles.css';
import './preview.css';

function Preview() {
  const [scenario, setScenario] = useState<ProductFixtureScenarioId>('HEALTHY_OBSERVE');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [motion, setMotion] = useState<'full' | 'reduced'>('full');
  return (
    <div className="pcr-preview" data-theme={theme} data-motion={motion}>
      <header className="pcr-preview-tools">
        <span><strong>IP-CONTROL Binding Preview</strong><small>Persistent Synthetic Fixture Surface</small></span>
        <label>Scenario
          <select value={scenario} onChange={(event) => setScenario(event.target.value as ProductFixtureScenarioId)}>
            {REQUIRED_FIXTURE_SCENARIOS.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Dark' : 'Light'} Theme</button>
        <button type="button" onClick={() => setMotion((current) => current === 'full' ? 'reduced' : 'full')}>{motion === 'full' ? 'Reduced Motion' : 'Full Motion'}</button>
      </header>
      <main><FixtureProductControlRoom scenarioId={scenario} /></main>
    </div>
  );
}

const node = document.getElementById('root');
if (!node) throw new Error('PRODUCT_CONTROL_ROOM_PREVIEW_ROOT_MISSING');
const host = node as HTMLElement & { __productControlRoomRoot?: Root };
host.__productControlRoomRoot ??= createRoot(host);
host.__productControlRoomRoot.render(<StrictMode><Preview /></StrictMode>);
