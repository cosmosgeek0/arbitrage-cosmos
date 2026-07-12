import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveCorrelationId } from '../../../dist/foundation/contracts/identity.js';

const {
  SAFE_DIAGNOSTIC_BOUNDS,
  SAFE_DIAGNOSTIC_KEYS,
  SAFE_DIAGNOSTIC_SCHEMA,
  SAFE_DIAGNOSTIC_SENTINELS,
  SAFE_FAILURE_CODES,
  createSafeFailure,
  projectSafeDiagnostic,
} = await import('../../../dist/liveEdge/adapters/binanceSignedKernel/safety.js');

const NOW = 1_783_949_000_000;
const CORRELATION_ID = deriveCorrelationId({ origin: 'l03-test', key: 'safety-0001' });
const REQUEST_ID = 'lrq_117b68a007cd68aa6c360428830f0bf3';
const INTENT_FINGERPRINT = '03f9cd2bbdcc77e4405242235fea1995';

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function serialized(value) {
  return JSON.stringify(value).toLowerCase();
}

test('closed failure codes construct exact frozen Foundation failures with no caller-authored message surface', () => {
  const expectedKeys = [
    'component',
    'stage',
    'code',
    'message',
    'occurredAt',
    'retryable',
    'safeCurrentState',
    'recommendedOperatorAction',
    'correlationId',
  ];

  assert.equal(Object.isFrozen(SAFE_FAILURE_CODES), true);
  assert.match(CORRELATION_ID, /^cor_[0-9a-f]{16}$/);

  for (const code of SAFE_FAILURE_CODES) {
    const failure = createSafeFailure({ code, occurredAtMs: NOW, correlationId: CORRELATION_ID });
    assert.deepEqual(Object.keys(failure), expectedKeys);
    assert.equal(failure.component, 'liveEdge.adapters.binanceSignedKernel');
    assert.equal(failure.code, code);
    assert.equal(failure.occurredAt, NOW);
    assert.equal(failure.retryable, false);
    assert.equal(failure.correlationId, CORRELATION_ID);
    assert.equal(typeof failure.message, 'string');
    assert.equal(Object.isFrozen(failure), true);
  }

  assert.deepEqual(
    createSafeFailure('MUTATION_AMBIGUOUS', NOW, CORRELATION_ID),
    createSafeFailure({
      code: 'MUTATION_AMBIGUOUS',
      occurredAtMs: NOW,
      correlationId: CORRELATION_ID,
    }),
  );
  assert.equal(
    createSafeFailure('MUTATION_AMBIGUOUS', NOW, CORRELATION_ID).safeCurrentState,
    'RECONCILIATION_REQUIRED',
  );
});

test('failure input is exact own data and invalid values fail with fixed non-reflective messages', () => {
  assert.throws(
    () => createSafeFailure({
      code: 'INPUT_REJECTED',
      occurredAtMs: NOW,
      correlationId: CORRELATION_ID,
      upstreamMessage: 'sentinel-upstream-message',
    }),
    (error) => error instanceof TypeError
      && error.message === 'createSafeFailure: input must be exact bounded own data'
      && !error.message.includes('sentinel'),
  );
  assert.throws(
    () => createSafeFailure('NOT_A_PUBLIC_CODE', NOW, 'sentinel-api-secret'),
    (error) => error instanceof TypeError
      && error.message === 'createSafeFailure: code is not in the closed failure vocabulary'
      && !error.message.includes('sentinel'),
  );
  assert.throws(
    () => createSafeFailure('INPUT_REJECTED', Number.NaN, 'sentinel-api-secret'),
    { message: 'createSafeFailure: occurredAtMs is invalid' },
  );
  assert.throws(
    () => createSafeFailure('INPUT_REJECTED', NOW, 'api_secret_sentinel'),
    { message: 'createSafeFailure: correlationId is invalid' },
  );
  for (const correlationId of [
    'cor_l03_safety_0001',
    `cor_${'a'.repeat(32)}`,
    `cor_${'a'.repeat(64)}`,
    'A1'.repeat(32),
  ]) {
    assert.throws(
      () => createSafeFailure('INPUT_REJECTED', NOW, correlationId),
      { message: 'createSafeFailure: correlationId is invalid' },
    );
  }

  let getterCalls = 0;
  const accessor = { code: 'INPUT_REJECTED', occurredAtMs: NOW };
  Object.defineProperty(accessor, 'correlationId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return CORRELATION_ID;
    },
  });
  assert.throws(() => createSafeFailure(accessor), /exact bounded own data/);
  assert.equal(getterCalls, 0);
});

test('failure validation rejects active and revoked proxies without invoking any trap', () => {
  const trapCalls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const active = new Proxy({}, {
    get() { trapCalls.get += 1; throw new Error('sentinel-proxy-get'); },
    getOwnPropertyDescriptor() { trapCalls.getOwnPropertyDescriptor += 1; throw new Error('sentinel-proxy-descriptor'); },
    getPrototypeOf() { trapCalls.getPrototypeOf += 1; throw new Error('sentinel-proxy-prototype'); },
    ownKeys() { trapCalls.ownKeys += 1; throw new Error('sentinel-proxy-keys'); },
  });
  assert.throws(() => createSafeFailure(active), /exact bounded own data/);
  assert.deepEqual(trapCalls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });

  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  assert.throws(() => createSafeFailure(revocable.proxy), /exact bounded own data/);
});

test('diagnostic projection has exactly three fields, retains only allowlisted safe data, and is deeply frozen', () => {
  const input = {
    state: 'BLOCKED',
    code: 'SIGNER_FAILURE_CONTAINED',
    product: 'SPOT',
    environment: 'PRODUCTION',
    contractId: 'SPOT_ORDER_TEST',
    requestId: REQUEST_ID,
    clientOrderId: 'cx-0123456789abcdef01234567-0',
    correlationId: CORRELATION_ID,
    fingerprint: INTENT_FINGERPRINT,
    sequence: 7,
    retryable: false,
    automaticRetry: false,
    reconciliationRequired: true,
    metadata: {
      state: 'UNSIGNED',
      observations: [{ kind: 'SAFE', statusCode: 503 }],
    },
  };
  const projected = projectSafeDiagnostic(input);

  assert.deepEqual(Object.keys(projected), ['schema', 'status', 'data']);
  assert.equal(projected.schema, SAFE_DIAGNOSTIC_SCHEMA);
  assert.equal(projected.status, 'EXACT');
  assert.deepEqual(projected.data, {
    automaticRetry: false,
    clientOrderId: 'cx-0123456789abcdef01234567-0',
    code: 'SIGNER_FAILURE_CONTAINED',
    contractId: 'SPOT_ORDER_TEST',
    correlationId: CORRELATION_ID,
    environment: 'PRODUCTION',
    fingerprint: INTENT_FINGERPRINT,
    metadata: {
      observations: [{ kind: 'SAFE', statusCode: 503 }],
      state: 'UNSIGNED',
    },
    product: 'SPOT',
    reconciliationRequired: true,
    requestId: REQUEST_ID,
    retryable: false,
    sequence: 7,
    state: 'BLOCKED',
  });
  assertDeeplyFrozen(projected);
  assert.equal(Object.isFrozen(SAFE_DIAGNOSTIC_BOUNDS), true);
  assert.equal(Object.isFrozen(SAFE_DIAGNOSTIC_KEYS), true);
  assert.equal(Object.isFrozen(SAFE_DIAGNOSTIC_SENTINELS), true);
  assert.deepEqual(projectSafeDiagnostic(input), projected);

  assert.deepEqual(projectSafeDiagnostic({
    contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE',
    requestId: 'rq_L03_000000000001',
  }), {
    schema: SAFE_DIAGNOSTIC_SCHEMA,
    status: 'EXACT',
    data: {
      contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE',
      requestId: 'rq_L03_000000000001',
    },
  });
});

test('opaque credential and signature shapes are redacted under every identifier-like allowlisted key', () => {
  const signatureHex = 'a'.repeat(64);
  const apiKeyAlphanumeric = 'Ab7Z'.repeat(16);
  for (const key of SAFE_DIAGNOSTIC_KEYS) {
    for (const secret of [signatureHex, apiKeyAlphanumeric]) {
      const crossKey = projectSafeDiagnostic({ [key]: secret });
      assert.equal(crossKey.status, 'SANITIZED', `${key} status`);
      assert.equal(crossKey.data[key], SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT, key);
      assert.equal(serialized(crossKey).includes(secret.toLowerCase()), false, key);
    }
  }
  for (const correlationId of [
    `cor_${'a'.repeat(32)}`,
    `cor_${'a'.repeat(64)}`,
    'cor_arbitrary',
  ]) {
    assert.equal(
      projectSafeDiagnostic({ correlationId }).data.correlationId,
      SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    );
  }

  const projected = projectSafeDiagnostic({
    fingerprint: signatureHex,
    requestId: apiKeyAlphanumeric,
    detail: signatureHex,
    correlationId: `cor_${signatureHex}`,
    contractId: apiKeyAlphanumeric,
    clientOrderId: apiKeyAlphanumeric,
    code: apiKeyAlphanumeric,
    state: signatureHex.toUpperCase(),
    metadata: {
      fingerprint: apiKeyAlphanumeric,
      reasonCode: signatureHex.toUpperCase(),
      requestId: signatureHex,
    },
  });

  assert.equal(projected.status, 'SANITIZED');
  assert.deepEqual(projected.data, {
    clientOrderId: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    code: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    contractId: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    correlationId: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    detail: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    fingerprint: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    metadata: {
      fingerprint: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
      reasonCode: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
      requestId: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    },
    requestId: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
    state: SAFE_DIAGNOSTIC_SENTINELS.UNSAFE_TEXT,
  });
  const output = serialized(projected);
  assert.equal(output.includes(signatureHex), false);
  assert.equal(output.includes(apiKeyAlphanumeric.toLowerCase()), false);
});

test('credentials, signatures, payloads, request material, private truth, causes and upstream messages are recursively omitted', () => {
  const sentinels = [
    'sentinel-credential',
    'sentinel-api-key',
    'sentinel-secret',
    'sentinel-signature',
    'sentinel-signed-payload',
    'sentinel-query',
    'sentinel-body',
    'sentinel-url',
    'sentinel-listen-key',
    'sentinel-token',
    'sentinel-authorization',
    'sentinel-account',
    'sentinel-balance',
    'sentinel-cause',
    'sentinel-stack',
    'sentinel-upstream-message',
  ];
  const projected = projectSafeDiagnostic({
    code: 'SIGNER_FAILURE_CONTAINED',
    state: 'UNSIGNED',
    credential: sentinels[0],
    apiKey: sentinels[1],
    secret: sentinels[2],
    signature: sentinels[3],
    signedPayload: sentinels[4],
    query: sentinels[5],
    body: sentinels[6],
    url: sentinels[7],
    listenKey: sentinels[8],
    token: sentinels[9],
    authorization: sentinels[10],
    accountId: sentinels[11],
    balance: sentinels[12],
    cause: new Error(sentinels[13]),
    stack: sentinels[14],
    upstreamMessage: sentinels[15],
    metadata: {
      state: 'BLOCKED',
      details: [{
        api_secret: 'sentinel-nested-secret',
        accountBalance: 10,
        message: 'sentinel-nested-message',
        reasonCode: 'SAFE_REASON',
      }],
    },
  });

  assert.equal(projected.status, 'SANITIZED');
  assert.deepEqual(projected.data, {
    code: 'SIGNER_FAILURE_CONTAINED',
    metadata: {
      details: [{ reasonCode: 'SAFE_REASON' }],
      state: 'BLOCKED',
    },
    state: 'UNSIGNED',
  });
  const output = serialized(projected);
  for (const sentinel of [...sentinels, 'sentinel-nested-secret', 'sentinel-nested-message']) {
    assert.equal(output.includes(sentinel), false, sentinel);
  }
  for (const privateKey of [
    'credential', 'apikey', 'secret', 'signature', 'signedpayload', 'query', 'body', 'url',
    'listenkey', 'token', 'authorization', 'account', 'balance', 'cause', 'stack', 'message', 'upstream',
  ]) {
    assert.equal(output.includes(`\"${privateKey}`), false, privateKey);
  }
});

test('accessors, active proxies and revoked proxies become sentinels without invoking getters or traps', () => {
  let getterCalls = 0;
  const accessorInput = { state: 'BLOCKED' };
  Object.defineProperty(accessorInput, 'detail', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'sentinel-getter-value';
    },
  });
  const accessorProjection = projectSafeDiagnostic(accessorInput);
  assert.equal(accessorProjection.status, 'SANITIZED');
  assert.equal(accessorProjection.data.detail, SAFE_DIAGNOSTIC_SENTINELS.ACCESSOR);
  assert.equal(getterCalls, 0);

  const trapCalls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const active = new Proxy({}, {
    get() { trapCalls.get += 1; throw new Error('sentinel-proxy-get'); },
    getOwnPropertyDescriptor() { trapCalls.getOwnPropertyDescriptor += 1; throw new Error('sentinel-proxy-descriptor'); },
    getPrototypeOf() { trapCalls.getPrototypeOf += 1; throw new Error('sentinel-proxy-prototype'); },
    ownKeys() { trapCalls.ownKeys += 1; throw new Error('sentinel-proxy-keys'); },
  });
  assert.equal(
    projectSafeDiagnostic({ metadata: active }).data.metadata,
    SAFE_DIAGNOSTIC_SENTINELS.PROXY,
  );
  assert.deepEqual(trapCalls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });

  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  const revokedProjection = projectSafeDiagnostic(revocable.proxy);
  assert.deepEqual(revokedProjection, {
    schema: SAFE_DIAGNOSTIC_SCHEMA,
    status: 'SANITIZED',
    data: SAFE_DIAGNOSTIC_SENTINELS.PROXY,
  });
});

test('cycles, unsupported prototypes and unsupported scalar values become fixed sentinels', () => {
  const cycle = {};
  cycle.detail = cycle;
  const cycleProjection = projectSafeDiagnostic({ metadata: cycle });
  assert.equal(cycleProjection.status, 'SANITIZED');
  assert.deepEqual(cycleProjection.data, {
    metadata: { detail: SAFE_DIAGNOSTIC_SENTINELS.CYCLE },
  });

  const inherited = Object.create({ secret: 'sentinel-inherited-secret' });
  inherited.state = 'UNSAFE_INHERITED';
  assert.equal(
    projectSafeDiagnostic({ metadata: inherited }).data.metadata,
    SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED,
  );

  const unsupported = projectSafeDiagnostic({
    detail: 1n,
    metadata: { state: Number.POSITIVE_INFINITY },
    items: [Symbol('sentinel-symbol'), () => 'sentinel-function'],
  });
  assert.equal(unsupported.status, 'SANITIZED');
  assert.deepEqual(unsupported.data, {
    detail: SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED,
    items: [SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED],
    metadata: { state: SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED },
  });

  const errorProjection = projectSafeDiagnostic(new Error('sentinel-upstream-secret-message'));
  assert.equal(errorProjection.data, SAFE_DIAGNOSTIC_SENTINELS.UNSUPPORTED);
  assert.equal(serialized(errorProjection).includes('sentinel'), false);
});

test('depth, node, key, array and string bounds fail closed with explicit non-fragment sentinels', () => {
  let nested = { state: 'LEAF' };
  for (let index = 0; index < SAFE_DIAGNOSTIC_BOUNDS.maximumDepth + 2; index += 1) {
    nested = { detail: nested };
  }
  const depthProjection = projectSafeDiagnostic(nested);
  assert.equal(depthProjection.status, 'BOUNDED');
  assert.equal(serialized(depthProjection).includes('depth_limit'), true);

  const manyNodes = {
    items: Array.from({ length: SAFE_DIAGNOSTIC_BOUNDS.maximumArrayLength }, () => (
      Array.from({ length: 4 }, () => true)
    )),
  };
  const nodeProjection = projectSafeDiagnostic(manyNodes);
  assert.equal(nodeProjection.status, 'BOUNDED');
  assert.equal(serialized(nodeProjection).includes('node_limit'), true);

  const tooManyKeys = {};
  for (let index = 0; index <= SAFE_DIAGNOSTIC_BOUNDS.maximumObjectKeys; index += 1) {
    tooManyKeys[`unknown_${index}`] = index;
  }
  assert.equal(
    projectSafeDiagnostic({ metadata: tooManyKeys }).data.metadata,
    SAFE_DIAGNOSTIC_SENTINELS.KEY_LIMIT,
  );

  const tooLongArray = Array.from(
    { length: SAFE_DIAGNOSTIC_BOUNDS.maximumArrayLength + 1 },
    () => false,
  );
  assert.equal(
    projectSafeDiagnostic({ items: tooLongArray }).data.items,
    SAFE_DIAGNOSTIC_SENTINELS.ARRAY_LIMIT,
  );

  const longSecretTail = `SAFE${'x'.repeat(SAFE_DIAGNOSTIC_BOUNDS.maximumStringLength)}sentinel-secret-tail`;
  const stringProjection = projectSafeDiagnostic({ detail: longSecretTail });
  assert.equal(stringProjection.data.detail, SAFE_DIAGNOSTIC_SENTINELS.STRING_LIMIT);
  assert.equal(serialized(stringProjection).includes('sentinel-secret-tail'), false);
});
