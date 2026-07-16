import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION,
  BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256,
  USDM_ALGO_OPEN_ORDERS_CONTRACT_ID,
  USDM_ALGO_OPEN_ORDERS_SOURCE,
  canonicalBinancePrivateTruthContractExtension,
  fingerprintBinancePrivateTruthContractExtension,
  matchDocumentedBinanceContract,
  resolveBinancePrivateTruthContractExtension,
} from '../../../dist/liveEdge/adapters/binanceContracts/index.js';

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ));
  return `{${entries.join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function independentSourceFingerprint(source) {
  return sha256(JSON.stringify([
    'BINANCE_OFFICIAL_SOURCE_EVIDENCE_V1',
    source.id,
    source.productScopes,
    source.pageTitle,
    source.officialUrl,
    source.checkedAt,
    source.lastModified,
    source.revisionSignal,
    source.digestScope,
    source.evidence,
    source.sourceContentDigestScope,
    source.sourceContentUrl,
    source.sourceContentSha256,
  ]));
}

function assertDeeplyFrozen(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    assert.equal(Object.isFrozen(current), true);
    pending.push(...Object.values(current));
  }
}

test('D14 private-truth contract extension is independently hash-locked to the frozen base', () => {
  const { contentSha256: ignored, ...content } = BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION;
  const independent = sha256(canonicalJson(content));
  assert.equal(ignored, BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256);
  assert.equal(independent, '3e5c1d75051f13f3150ba20653d1de1bff355b0732a0155a09a9de57c5907415');
  assert.equal(fingerprintBinancePrivateTruthContractExtension(content), independent);
  assert.equal(
    independentSourceFingerprint(USDM_ALGO_OPEN_ORDERS_SOURCE),
    'b9c8b75c67c26f6d8b1d69f84146173d1aed11a47d31cb3bd81d4f5033422c84',
  );
  assert.equal(content.baseMatrixSha256, BINANCE_CONTRACT_MATRIX_CONTENT_SHA256);
  assert.equal(canonicalBinancePrivateTruthContractExtension(),
    BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION);
  assertDeeplyFrozen(BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION);
});

test('algo open orders remain a distinct read-only USD-M contract with no action authority', () => {
  const contract = resolveBinancePrivateTruthContractExtension(
    BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
    BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256,
    USDM_ALGO_OPEN_ORDERS_CONTRACT_ID,
  );
  assert.ok(contract);
  assert.deepEqual({
    id: contract.id,
    product: contract.product,
    environment: contract.environment,
    realm: contract.realm,
    transport: contract.transport,
    lifecycle: contract.lifecycle,
    baseUrl: contract.baseUrl,
    operation: contract.operation,
  }, {
    id: 'USDM_ALGO_OPEN_ORDERS_QUERY',
    product: 'USD_M_PERPETUAL',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_ACCOUNT',
    transport: 'REST',
    lifecycle: 'CURRENT',
    baseUrl: 'https://fapi.binance.com',
    operation: {
      kind: 'REST_PATH', httpMethod: 'GET', value: '/fapi/v1/openAlgoOrders',
      queryTemplate: null,
    },
  });
  assert.deepEqual(contract.authentication, {
    securityType: 'USER_DATA',
    permittedKeyTypes: ['HMAC', 'RSA'],
    signingAlgorithm: 'HMAC_RSA',
    canonicalEncoding: 'TOTAL_PARAMS_QUERY_THEN_BODY',
    timestampUnit: 'MILLISECONDS',
    recvWindowDefaultMs: 5_000,
    recvWindowMaxMs: 60_000,
    requiredParameters: ['timestamp'],
  });
  assert.deepEqual(contract.rateLimit.claims.map(({ value, condition }) => ({
    value, condition,
  })), [
    { value: 1, condition: 'WITH_SYMBOL' },
    { value: 40, condition: 'WITHOUT_SYMBOL' },
  ]);
  assert.equal(contract.mutationClass, 'ORDER_QUERY_READ');
  assert.equal(contract.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(contract.externalActionAuthorization, 'NONE');
  assert.equal(contract.actionAuthority, 'NONE_RECORD_ONLY');
});

test('standard open orders and altered routes cannot substitute for the D14 contract', () => {
  for (const candidate of [
    'USDM_OPEN_ORDERS_QUERY',
    null,
    'SPOT_OPEN_ORDERS_QUERY',
  ]) {
    assert.equal(resolveBinancePrivateTruthContractExtension(
      BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
      BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256,
      candidate,
    ), null);
  }
  assert.equal(resolveBinancePrivateTruthContractExtension(
    '0'.repeat(64),
    BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256,
    USDM_ALGO_OPEN_ORDERS_CONTRACT_ID,
  ), null);
  assert.equal(resolveBinancePrivateTruthContractExtension(
    BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
    '0'.repeat(64),
    USDM_ALGO_OPEN_ORDERS_CONTRACT_ID,
  ), null);

  const contract = BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION.contract;
  for (const operation of [
    { ...contract.operation, value: '/fapi/v1/allAlgoOrders' },
    { ...contract.operation, httpMethod: 'POST' },
  ]) {
    const result = matchDocumentedBinanceContract({
      id: 'D14_HOSTILE_ROUTE',
      product: contract.product,
      environment: contract.environment,
      realm: contract.realm,
      transport: contract.transport,
      baseUrl: contract.baseUrl,
      operation,
    });
    assert.equal(result.ok, false);
  }
  const standardResult = matchDocumentedBinanceContract({
    id: 'D14_STANDARD_OPEN_ORDERS_ROUTE',
    product: contract.product,
    environment: contract.environment,
    realm: contract.realm,
    transport: contract.transport,
    baseUrl: contract.baseUrl,
    operation: { ...contract.operation, value: '/fapi/v1/openOrders' },
  });
  assert.equal(standardResult.ok, true);
  assert.equal(standardResult.contractId, 'USDM_OPEN_ORDERS_QUERY');
  const baseResult = matchDocumentedBinanceContract({
    id: 'D14_EXACT_EXTENSION_ROUTE',
    product: contract.product,
    environment: contract.environment,
    realm: contract.realm,
    transport: contract.transport,
    baseUrl: contract.baseUrl,
    operation: contract.operation,
  });
  assert.equal(baseResult.ok, false);
  assert.equal(baseResult.code, 'UNREGISTERED_DOCUMENTARY_CONTRACT');
});
