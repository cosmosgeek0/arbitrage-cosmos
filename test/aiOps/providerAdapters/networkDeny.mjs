import { after } from 'node:test';
import { installEgressTripwire } from '../../../server/test/systemIntegration/fixtures/egress-tripwire.mjs';

const tripwire = installEgressTripwire({ maximumAttempts: 32 });

after(() => {
  tripwire.assertNoAttempts('A3 provider adapter focused suite');
  tripwire.restore();
});

export async function loadA3() {
  return import('../../../server/dist/aiOps/providerAdapters/index.js');
}
