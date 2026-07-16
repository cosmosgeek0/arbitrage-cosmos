import { after } from 'node:test';
import { installEgressTripwire } from '../../systemIntegration/fixtures/egress-tripwire.mjs';

const tripwire = installEgressTripwire({ maximumAttempts: 32 });

after(() => {
  tripwire.assertNoAttempts('A3 provider adapter focused suite');
  tripwire.restore();
});

export async function loadA3() {
  return import('../../../dist/aiOps/adapters/index.js');
}
