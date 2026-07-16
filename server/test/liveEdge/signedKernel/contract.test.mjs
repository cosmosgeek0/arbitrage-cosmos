import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINANCE_SIGNER_PROFILES,
  L03_BINANCE_MATRIX_SHA256,
  resolveSignedContract,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/contract.js';

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

test('signed-contract policy is pinned to the accepted L02 matrix and selected HMAC profiles', () => {
  assert.equal(
    L03_BINANCE_MATRIX_SHA256,
    '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac',
  );
  assert.deepEqual(BINANCE_SIGNER_PROFILES, ['SPOT_HMAC_SHA256', 'USDM_HMAC_SHA256']);
  assertDeeplyFrozen(BINANCE_SIGNER_PROFILES);
});

test('exact current Spot and USD-M REST contracts resolve as documentary non-authority', () => {
  const spot = resolveSignedContract('SPOT_ACCOUNT_BALANCES', 'SPOT', 'PRODUCTION');
  assert.deepEqual(spot, {
    ok: true,
    contract: {
      contractId: 'SPOT_ACCOUNT_BALANCES',
      product: 'SPOT',
      environment: 'PRODUCTION',
      realm: 'PRIVATE_ACCOUNT',
      method: 'GET',
      signerProfile: 'SPOT_HMAC_SHA256',
      requiredParameters: ['timestamp'],
      mutationClass: 'PRIVATE_ACCOUNT_READ',
      safeRetryClass: 'NOT_APPLICABLE',
      rateState: 'VERIFIED',
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
      externalActionAuthorization: 'NONE',
      actionAuthority: 'NONE_RECORD_ONLY',
    },
  });
  assertDeeplyFrozen(spot);

  const usdm = resolveSignedContract('USDM_ACCOUNT_V3', 'USD_M_PERPETUAL', 'PRODUCTION');
  assert.deepEqual(usdm, {
    ok: true,
    contract: {
      contractId: 'USDM_ACCOUNT_V3',
      product: 'USD_M_PERPETUAL',
      environment: 'PRODUCTION',
      realm: 'PRIVATE_ACCOUNT',
      method: 'GET',
      signerProfile: 'USDM_HMAC_SHA256',
      requiredParameters: ['timestamp'],
      mutationClass: 'PRIVATE_ACCOUNT_READ',
      safeRetryClass: 'NOT_APPLICABLE',
      rateState: 'VERIFIED',
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
      externalActionAuthorization: 'NONE',
      actionAuthority: 'NONE_RECORD_ONLY',
    },
  });
  assertDeeplyFrozen(usdm);
});

test('rate uncertainty remains explicit on an otherwise signable USD-M test-order contract', () => {
  const result = resolveSignedContract('USDM_TEST_ORDER_POST', 'USD_M_PERPETUAL', 'PRODUCTION');
  assert.equal(result.ok, true);
  assert.equal(result.contract.rateState, 'UNKNOWN');
  assert.equal(result.contract.mutationClass, 'TEST_ORDER_MUTATION');
  assert.equal(result.contract.safeRetryClass, 'NEVER_AUTOMATIC');
  assert.equal(result.contract.actionAuthority, 'NONE_RECORD_ONLY');
});

test('free-form, cross-scope, non-REST, non-current, public, and unresolved signing choices fail closed', async (t) => {
  const cases = [
    ['malformed ID', ['../SPOT_ACCOUNT_BALANCES', 'SPOT', 'PRODUCTION'], 'CONTRACT_ID_INVALID'],
    ['unknown ID', ['SPOT_NOT_REGISTERED', 'SPOT', 'PRODUCTION'], 'CONTRACT_NOT_FOUND'],
    ['unknown product', ['SPOT_ACCOUNT_BALANCES', 'MARGIN', 'PRODUCTION'], 'EXPECTED_PRODUCT_INVALID'],
    ['non-production environment', ['SPOT_ACCOUNT_BALANCES', 'SPOT', 'TESTNET'], 'EXPECTED_ENVIRONMENT_INVALID'],
    ['cross-product substitution', ['USDM_ACCOUNT_V3', 'SPOT', 'PRODUCTION'], 'CONTRACT_SCOPE_MISMATCH'],
    ['WebSocket substitution', ['SPOT_WS_API_USER_DATA_SIGNATURE', 'SPOT', 'PRODUCTION'], 'CONTRACT_NOT_CURRENT_REST'],
    ['removed REST contract', ['SPOT_REST_USER_DATA_STREAM_POST_REMOVED', 'SPOT', 'PRODUCTION'], 'CONTRACT_NOT_CURRENT_REST'],
    ['public unsigned REST contract', ['SPOT_SERVER_TIME', 'SPOT', 'PRODUCTION'], 'SIGNING_POLICY_UNRESOLVED'],
    ['wallet signing policy unresolved', ['SPOT_API_KEY_PERMISSIONS', 'SPOT', 'PRODUCTION'], 'SIGNING_POLICY_UNRESOLVED'],
    ['Margin cannot be cross-cast to Spot', ['MARGIN_ORDER_CANCEL', 'SPOT', 'PRODUCTION'], 'CONTRACT_SCOPE_MISMATCH'],
  ];

  for (const [name, args, code] of cases) {
    await t.test(name, () => {
      const result = resolveSignedContract(...args);
      assert.deepEqual(result, { ok: false, code });
      assertDeeplyFrozen(result);
    });
  }
});
