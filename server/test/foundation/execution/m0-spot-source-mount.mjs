import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createM0SpotSourceMount,
  M0_SPOT_SOURCE_MOUNT_SCHEMA,
} from '../../../dist/foundation/execution/m0SpotSourceMount.js';

function invocation(overrides = {}) {
  return {
    requestId: 'm0_req_0123456789abcdef0123456789abcdef',
    ownerConfirmation: 'YES',
    operator: {
      id: 'owner-m0-source-test',
      email: null,
      source: 'loopback',
    },
    ...overrides,
  };
}

test('plain YES reaches only the frozen validate/test-order source posture', async () => {
  const result = await createM0SpotSourceMount().inspectSourceMount(
    invocation(),
  );

  assert.equal(result.schema, M0_SPOT_SOURCE_MOUNT_SCHEMA);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'M0_SOURCE_MOUNT_BLOCKED');
  assert.equal(
    result.state,
    'VALIDATE_TEST_ORDER_SOURCE_MOUNTED_NOT_ACTIVATED',
  );
  assert.equal(result.sourceMounted, true);
  assert.equal(result.runtimeActivated, false);
  assert.equal(result.hostProvisioned, false);
  assert.equal(result.liveExecutionPermitted, false);
  assert.equal(result.ownerConfirmation, 'ACKNOWLEDGED_NOT_AUTHORITY');
  assert.equal(result.maximumOrderNotionalQuote, '10');
  assert.equal(result.maximumOrderNotionalAsset, 'USDT');
  assert.deepEqual(result.admission, {
    sourceEnabled: false,
    killSwitchEngaged: true,
    allowedSymbols: [],
    approvedUsdQuoteAssets: [],
  });

  assert.equal(result.validation.mode, 'VALIDATE_ONLY');
  assert.equal(result.validation.localValidationPassed, false);
  assert.deepEqual(result.validation.blockingCodes, ['SOURCE_DISABLED']);
  assert.equal(result.validation.ownerOrderNotionalCeilingQuote, '10');
  assert.equal(result.validation.signedTestRequired, true);
  assert.equal(result.validation.signedTestPerformed, false);
  assert.equal(result.validation.signedTestIntentExposed, false);
  assert.equal(result.validation.liveSendAuthorized, false);
  assert.equal(result.validation.sendsPerformed, 0);
  assert.equal(result.validation.sideEffectsPerformed, 0);
  assert.equal(result.validation.externalActionAuthorization, 'NONE');
  assert.deepEqual(result.validation.permittedExternalActions, []);

  assert.deepEqual(result.testOrder, {
    mode: 'SIGNED_TEST_ORDER_ONLY',
    orderType: 'LIMIT',
    notionalBasis: 'SIGNED_LIMIT_PRICE_TIMES_QUANTITY',
    method: 'POST',
    path: '/api/v3/order/test',
    authorityScope: 'BINANCE_SPOT_TEST_ORDER_ONLY',
    authorityCardinality: 'ONE_USE',
    authoritySource: 'SEPARATE_SERVER_AUTHORITY_REQUIRED',
    authorityState: 'NOT_PRESENT',
    authorityConsumption: 'NOT_ATTEMPTED',
    intent: null,
    signedRequest: 'NOT_CONSTRUCTED',
    transport: 'NOT_CONFIGURED',
    receipt: 'NOT_ATTEMPTED',
    createsVenueOrder: false,
    automaticRetry: false,
    calls: 0,
  });
  assert.equal(result.submitAuthority, 'NONE');
  assert.equal(result.withdrawalPolicy, 'DISABLED');
  assert.equal(result.transferPolicy, 'DISABLED');
  assert.equal(result.flat, 'NOT_PROVED');
  assert.equal(result.reconciliation, 'NOT_PROVED');
  assert.equal(result.disarm, 'NOT_PROVED');
  assert.deepEqual(result.effects, {
    authorityConsumptions: 0,
    signatures: 0,
    transportCalls: 0,
    privateCalls: 0,
    testOrders: 0,
    submits: 0,
    transfers: 0,
    withdrawals: 0,
    moneyMutations: 0,
  });
});

test('request JSON cannot inject ticket or authority into the source mount', async () => {
  const mount = createM0SpotSourceMount();
  for (const candidate of [
    null,
    {},
    invocation({ ownerConfirmation: 'yes' }),
    invocation({ requestId: 'm0_req_short' }),
    invocation({ authority: { singleUse: true } }),
    invocation({ ticket: { orderNotionalQuote: '10' } }),
    invocation({ operator: { id: 'owner', source: 'loopback' } }),
    Object.create(invocation()),
  ]) {
    await assert.rejects(
      () => mount.inspectSourceMount(candidate),
      /M0 Spot source-mount invocation is invalid/u,
    );
  }
});

test('source mount construction and repeated inspection remain deeply inert', async () => {
  const mount = createM0SpotSourceMount();
  const [left, right] = await Promise.all([
    mount.inspectSourceMount(invocation()),
    mount.inspectSourceMount(invocation()),
  ]);
  assert.deepEqual(left, right);
  assert.equal(Object.isFrozen(mount), true);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.admission), true);
  assert.equal(Object.isFrozen(left.testOrder), true);
  assert.equal(Object.isFrozen(left.effects), true);
});
