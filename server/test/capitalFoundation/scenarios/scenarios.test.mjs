import test from 'node:test';

import {
  CAPITAL_SUPERVISION_SCENARIOS,
  runCapitalSupervisionScenario,
} from './harness.mjs';

for (const entry of CAPITAL_SUPERVISION_SCENARIOS) {
  test(`${entry.id} ${entry.name}`, () => {
    runCapitalSupervisionScenario(entry);
  });
}
