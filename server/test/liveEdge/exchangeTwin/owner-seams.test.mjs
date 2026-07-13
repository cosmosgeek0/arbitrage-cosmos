import assert from 'node:assert/strict';
import test from 'node:test';

import { createRateBudgetState } from '../../../dist/liveEdge/adapters/binanceSignedKernel/index.js';
import { exchangeTwinOwnerEvidenceSha256 } from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateExchangeTwinInstrumentPreflight,
  evaluateExchangeTwinRateReservation,
} from '../../../dist/liveEdge/adapters/exchangeTwin/ownerEvidence.js';

test('owner evidence digest is deterministic and content-sensitive', () => {
  const evidence = { schema: 'OWNER_EVIDENCE_TEST_V1', revision: 'owner-revision-0001', value: '1' };
  const first = exchangeTwinOwnerEvidenceSha256(evidence);
  const second = exchangeTwinOwnerEvidenceSha256({ ...evidence });
  const changed = exchangeTwinOwnerEvidenceSha256({ ...evidence, value: '2' });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
  assert.notEqual(changed, first);
});

test('L04 wrapper preserves canonical hostile-input rejection without fabricating a pass', () => {
  const result = evaluateExchangeTwinInstrumentPreflight({}, {}, 1);
  assert.notEqual(result.staticState, 'PASS');
  assert.ok(result.reasonCodes.includes('STATIC_PREFLIGHT_INPUT_REJECTED'));
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
});

test('L03 wrapper returns the canonical owner decision and binds injected time exactly', () => {
  const atMs = 1_000;
  const input = {
    contractId: 'SPOT_OPEN_ORDERS_QUERY',
    product: 'SPOT',
    environment: 'PRODUCTION',
    scopeHandles: { IP: 'egress:prod-a', ACCOUNT: 'account:execution-a' },
    capacities: [{
      product: 'SPOT',
      environment: 'PRODUCTION',
      scopeKind: 'IP',
      scopeHandle: 'egress:prod-a',
      rateKind: 'REQUEST_WEIGHT',
      interval: 'MINUTE',
      capacity: 200,
      windowStartedAtMs: 0,
      windowEndsAtMs: 60_000,
    }],
    atMs,
  };
  const state = createRateBudgetState();
  const decision = evaluateExchangeTwinRateReservation(state, input, atMs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'USAGE_UNKNOWN');
  assert.strictEqual(decision.state, state);
  assert.throws(
    () => evaluateExchangeTwinRateReservation(state, input, atMs + 1),
    /must equal the supplied twin time/,
  );
});
