import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BINANCE_CONTRACT_MATRIX,
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  canonicalBinanceContractMatrix,
  fingerprintBinanceContractMatrix,
  matchDocumentedBinanceContract,
  validateBinanceContractMatrix,
} from '../../../dist/liveEdge/adapters/binanceContracts/index.js';
import {
  CHECKED_BINANCE_ROUTE_FIXTURES,
  addOwnDataProperty,
  assertDeeplyFrozen,
  cloneMatrix,
  fixtureFromContract,
} from './fixtures.mjs';

function codePointCompare(left, right) {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftPoint = leftPoints.next();
    const rightPoint = rightPoints.next();
    if (leftPoint.done || rightPoint.done) {
      if (leftPoint.done === rightPoint.done) return 0;
      return leftPoint.done ? -1 : 1;
    }
    const leftCode = leftPoint.value.codePointAt(0) ?? 0;
    const rightCode = rightPoint.value.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value).sort(codePointCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
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

function independentMatrixFingerprint(matrix) {
  return sha256(canonicalJson({
    schema: matrix.schema,
    revision: matrix.revision,
    checkedAt: matrix.checkedAt,
    documentaryAuthority: matrix.documentaryAuthority,
    externalActionAuthorization: matrix.externalActionAuthorization,
    selectedPrivateContractIds: matrix.selectedPrivateContractIds,
    selectedSpotUserDataEncoding: matrix.selectedSpotUserDataEncoding,
    selectedSpotSignatureKeyType: matrix.selectedSpotSignatureKeyType,
    spotUserDataLifecycle: matrix.spotUserDataLifecycle,
    rateHeaderTemplates: matrix.rateHeaderTemplates,
    protectedLocators: matrix.protectedLocators,
    marginAccountModeFacts: matrix.marginAccountModeFacts,
    apiKeyProfilePolicy: matrix.apiKeyProfilePolicy,
    apiKeyPermissionFields: matrix.apiKeyPermissionFields,
    unsupportedAccountModes: matrix.unsupportedAccountModes,
    sources: matrix.sources,
    contracts: matrix.contracts,
    approvedProductBases: matrix.approvedProductBases,
    obsoleteRouteFacts: matrix.obsoleteRouteFacts,
  }));
}

function contract(id) {
  const found = BINANCE_CONTRACT_MATRIX.contracts.find((candidate) => candidate.id === id);
  assert.ok(found, `missing contract ${id}`);
  return found;
}

function issueCodes(result) {
  assert.equal(result.ok, false, 'hostile matrix unexpectedly validated');
  return result.issues.map((issue) => issue.code);
}

function assertRejectedFixture(fixture, code) {
  const result = matchDocumentedBinanceContract(fixture);
  assert.equal(result.ok, false, `fixture unexpectedly matched ${code}`);
  assert.equal(result.code, code);
  assert.equal(Object.isFrozen(result), true);
  return result;
}

test('canonical matrix is exact, hash-locked, detached, and recursively frozen', () => {
  const independent = independentMatrixFingerprint(BINANCE_CONTRACT_MATRIX);
  assert.equal(independent, '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac');
  assert.equal(BINANCE_CONTRACT_MATRIX_CONTENT_SHA256, independent);
  assert.equal(fingerprintBinanceContractMatrix(BINANCE_CONTRACT_MATRIX), independent);

  const result = validateBinanceContractMatrix(BINANCE_CONTRACT_MATRIX);
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.issues));
  assert.notEqual(result.matrix, BINANCE_CONTRACT_MATRIX);
  assert.equal(result.matrix.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(result.matrix.externalActionAuthorization, 'NONE');
  assert.deepEqual(new Set(result.matrix.contracts.map((item) => item.product)), new Set(['SPOT', 'USD_M_PERPETUAL', 'MARGIN']));
  assert.deepEqual(new Set(result.matrix.contracts.map((item) => item.environment)), new Set(['PRODUCTION', 'DEMO', 'TESTNET']));
  assert.deepEqual(result.matrix.selectedPrivateContractIds, {
    SPOT: 'SPOT_WS_API_USER_DATA_SIGNATURE',
    USD_M_PERPETUAL: 'USDM_WS_PRIVATE_USER_DATA',
    MARGIN: null,
  });
  assert.equal(result.matrix.selectedSpotUserDataEncoding, 'JSON_TEXT');
  assert.equal(result.matrix.selectedSpotSignatureKeyType, 'HMAC');
  assertDeeplyFrozen(assert, BINANCE_CONTRACT_MATRIX);
  assertDeeplyFrozen(assert, result.matrix);
  assert.deepEqual(canonicalBinanceContractMatrix(), result.matrix);
});

test('every evidence hash and captured official source hash is independently exact', () => {
  for (const source of BINANCE_CONTRACT_MATRIX.sources) {
    assert.equal(source.digestScope, 'CANONICAL_EVIDENCE_SET');
    assert.equal(independentSourceFingerprint(source), source.evidenceSha256, source.id);
  }
  const captured = new Map(BINANCE_CONTRACT_MATRIX.sources
    .filter((source) => source.sourceContentDigestScope !== 'NOT_CAPTURED')
    .map((source) => [source.id, source.sourceContentSha256]));
  assert.deepEqual(captured, new Map([
    ['SPOT_REST_2026_06_26', '49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999'],
    ['SPOT_WS_API_GIT_31643ED', 'c09a1f5c7ebfd111fed79f07e98c3cf0d862d0f3c8d6636b57bd2dac83d09a8d'],
    ['SPOT_USER_DATA_GIT_31643ED', '3e0fcf4952615981bb6e033c9d968904bad779ccafd970256802857d386671a8'],
    ['SPOT_CHANGELOG_GIT_31643ED', '3c87303c7ba632d7240d34a7271652aaa8a4f5aebe8023eec6ab36a13bd10f8a'],
    ['SPOT_STREAMS_GIT_31643ED', '32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a'],
    ['USDM_GENERAL_2026_06_26', 'b2e647582fb3ae4cae3a79d6f6f6030d0c03cf403d05176117b24094a083521b'],
    ['USDM_ROUTE_NOTICE_2026_07_10', '7711169f43066cb169fa40d90193731630ffca43dc2c04a2c753a5814b596f5c'],
    ['USDM_USER_DATA_2026_07_10', '333e83f6a7e09a58ad713f333c0175f0618e967bb70ee7bb067c909195667f56'],
    ['USDM_CONNECT_2026_07_10', '912f2dad9da21b5c1801d73f052473b6a1d7136a43b2ff3e7a1c2cdc54abdde2'],
    ['MARGIN_CHANGELOG_2026_07_10', 'a698dcc1482c5638e8e11e56c4443d91cfeb86bd8a547aa7319891c66c0483e3'],
    ['SPOT_DEMO_GIT_31643ED', '6b07adb3cc2ca92828cb74a27c7a2e3a3f7c75de9ba362843ecd1e636409073d'],
    ['SPOT_TESTNET_GENERAL_GIT_31643ED', 'f6ff938f0d8bb8bb6b0496ce3010aaf847c385060da49d271d34b9b8ebb60be1'],
    ['SPOT_TESTNET_WS_API_GIT_31643ED', '5ee59d1a59f8b5c3410af618b235203a4e1c6959afdf735950fbaa5bc068de24'],
    ['SPOT_TESTNET_STREAMS_GIT_31643ED', '13428b2e5f4d9dc7654331d4c65e6befea776d2b7408fe5980343708f72d96e6'],
    ['SPOT_FILTERS_GIT_31643ED', '4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3'],
    ['SPOT_SBE_STREAMS_GIT_31643ED', 'dea073ea9d728dac86f8e671faa6042a6da6b071347a7467f4e0a86c9667c0ec'],
    ['SPOT_SBE_SCHEMA_3_5_GIT_31643ED', '542776a038883dafe962341a041323ff5d8d3e36f1b860ab60156a88a4080bcf'],
    ['USDM_LOCAL_BOOK_2026_07_10', 'd6a94d17fb32450c67ad598c0f923bf9df12ecdc43ced4928798a9fa56d62622'],
    ['USDM_WS_API_GENERAL_2026_07_10', '66ff09decfb77bf7be8a6da5e9534b0b94310b84ff94641b8552974f0c2b4f41'],
    ['MARGIN_GENERAL_2026_07_10', '7feccdbe7831a877af65b6fecfb915c176a1cc29f9df173ff3a685af9f98e2af'],
    ['MARGIN_RISK_STREAM_2026_07_10', '0f8ed45d12e743d7b009e1458bba9198e2cfd0dade3b7237fc9d06f13015b656'],
  ]));
});

test('all records remain documentary-only and expose no action authority', () => {
  for (const item of BINANCE_CONTRACT_MATRIX.contracts) {
    assert.equal(item.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
    assert.equal(item.externalActionAuthorization, 'NONE');
    assert.equal(item.actionAuthority, 'NONE_RECORD_ONLY');
  }
  assert.equal(contract('MARGIN_BORROW_REPAY_POST').mutationClass, 'MARGIN_MUTATION');
  assert.equal(contract('MARGIN_BORROW_REPAY_POST').actionAuthority, 'NONE_RECORD_ONLY');
});

test('hand-authored official tuples match the exact hash-locked contracts', () => {
  assert.ok(CHECKED_BINANCE_ROUTE_FIXTURES.length >= 30);
  for (const { expectedContractId, fixture } of CHECKED_BINANCE_ROUTE_FIXTURES) {
    const result = matchDocumentedBinanceContract(fixture);
    assert.deepEqual(result, {
      ok: true,
      contractId: expectedContractId,
      lifecycle: 'CURRENT',
      actionAuthority: 'NONE_RECORD_ONLY',
    }, expectedContractId);
  }
});

test('the directive capability roster is complete across product and environment realms', () => {
  const required = [
    'SPOT_REST_PRODUCTION_BASE', 'SPOT_DEMO_REST_BASE', 'SPOT_TESTNET_REST_BASE',
    'SPOT_WS_API_USER_DATA_SESSION', 'SPOT_WS_API_USER_DATA_SIGNATURE', 'SPOT_WS_USER_DATA_UNSUBSCRIBE',
    'SPOT_WS_PUBLIC_RAW_STREAM', 'SPOT_PUBLIC_COMBINED_STREAM', 'SPOT_SBE_PUBLIC_RAW_STREAM', 'SPOT_SBE_PUBLIC_COMBINED_STREAM',
    'SPOT_SERVER_TIME', 'SPOT_EXCHANGE_INFO_FILTERS', 'SPOT_ACCOUNT_BALANCES', 'SPOT_ACCOUNT_FILTERS',
    'SPOT_ORDER_POST', 'SPOT_TEST_ORDER_POST', 'SPOT_ORDER_QUERY', 'SPOT_ORDER_CANCEL',
    'SPOT_OPEN_ORDERS_QUERY', 'SPOT_ALL_ORDERS_QUERY', 'SPOT_MY_TRADES_QUERY', 'SPOT_COMMISSION_QUERY',
    'SPOT_POSITION_ENDPOINT_NOT_APPLICABLE', 'SPOT_API_KEY_PERMISSIONS',
    'SPOT_ACCOUNT_API_TRADING_STATUS', 'SPOT_ACCOUNT_STATUS',
    'USDM_REST_PRODUCTION_BASE', 'USDM_DEMO_REST_BASE', 'USDM_TESTNET_REST_BASE',
    'USDM_WS_API_PRODUCTION_BASE', 'USDM_WS_API_TESTNET_BASE', 'USDM_DEMO_WS_STREAM_BASE',
    'USDM_WS_PUBLIC_RAW_STREAM', 'USDM_WS_PUBLIC_COMBINED_STREAM', 'USDM_WS_MARKET_RAW_STREAM', 'USDM_WS_MARKET_COMBINED_STREAM',
    'USDM_WS_PRIVATE_USER_DATA', 'USDM_WS_PRIVATE_USER_DATA_QUERY_RAW', 'USDM_WS_PRIVATE_USER_DATA_COMBINED',
    'USDM_LISTEN_KEY_POST', 'USDM_LISTEN_KEY_PUT', 'USDM_LISTEN_KEY_DELETE',
    'USDM_SERVER_TIME', 'USDM_EXCHANGE_INFO_FILTERS', 'USDM_DEPTH_SNAPSHOT',
    'USDM_ACCOUNT_V3', 'USDM_BALANCE_V3', 'USDM_POSITION_RISK_V3',
    'USDM_ORDER_POST', 'USDM_TEST_ORDER_POST', 'USDM_ORDER_QUERY', 'USDM_ORDER_CANCEL',
    'USDM_OPEN_ORDERS_QUERY', 'USDM_ALL_ORDERS_QUERY', 'USDM_USER_TRADES_QUERY',
    'USDM_CANCEL_ALL_OPEN_ORDERS', 'USDM_COUNTDOWN_CANCEL_ALL', 'USDM_API_KEY_PERMISSIONS',
    'USDM_ACCOUNT_API_TRADING_STATUS', 'USDM_ACCOUNT_STATUS',
    'USDM_MULTI_ASSETS_MODE_QUERY', 'USDM_POSITION_MODE_QUERY',
    'MARGIN_REST_PRODUCTION_BASE', 'MARGIN_DEMO_PRIVATE_REST_UNKNOWN', 'MARGIN_TESTNET_PRIVATE_REST_UNKNOWN',
    'MARGIN_SERVER_TIME', 'MARGIN_EXCHANGE_INFO_FILTERS', 'MARGIN_CROSS_ACCOUNT_BALANCES', 'MARGIN_ISOLATED_ACCOUNT_BALANCES',
    'MARGIN_POSITION_ENDPOINT_NOT_APPLICABLE', 'MARGIN_ORDER_POST_SCOPE_CONFLICT', 'MARGIN_TEST_ORDER_UNKNOWN',
    'MARGIN_ORDER_QUERY', 'MARGIN_ORDER_CANCEL', 'MARGIN_OPEN_ORDERS_QUERY', 'MARGIN_OPEN_ORDERS_CANCEL_ALL',
    'MARGIN_ALL_ORDERS_QUERY', 'MARGIN_MY_TRADES_QUERY', 'MARGIN_BORROW_REPAY_POST',
    'MARGIN_BORROW_REPAY_HISTORY_PARAMETER_CONFLICT', 'MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT',
    'MARGIN_INTEREST_HISTORY_QUERY', 'MARGIN_INTEREST_RATE_HISTORY_QUERY', 'MARGIN_AVAILABLE_INVENTORY_QUERY',
    'MARGIN_TRADE_LISTEN_TOKEN_POST_UNKNOWN', 'MARGIN_TRADE_LISTEN_TOKEN_SUBSCRIBE_UNKNOWN',
    'MARGIN_RISK_LISTEN_KEY_POST', 'MARGIN_RISK_LISTEN_KEY_PUT', 'MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT',
    'MARGIN_RISK_WS_RAW', 'MARGIN_RISK_WS_COMBINED', 'MARGIN_API_KEY_PERMISSIONS',
    'MARGIN_ACCOUNT_API_TRADING_STATUS', 'MARGIN_ACCOUNT_STATUS',
  ];
  const ids = new Set(BINANCE_CONTRACT_MATRIX.contracts.map((item) => item.id));
  assert.equal(required.length, new Set(required).size);
  for (const id of required) assert.ok(ids.has(id), id);
});

test('every locatable contract matches iff its lifecycle is current', () => {
  const locatable = BINANCE_CONTRACT_MATRIX.contracts.filter((item) => item.baseUrl !== null && item.operation !== null);
  for (const item of locatable) {
    const result = matchDocumentedBinanceContract(fixtureFromContract(item));
    assert.equal(result.ok, item.lifecycle === 'CURRENT', item.id);
  }
});

test('critical lifecycle, schema, and rate facts are structured rather than prose-only', () => {
  assert.deepEqual(BINANCE_CONTRACT_MATRIX.spotUserDataLifecycle, {
    oneActiveSubscriptionPerAccountPerConnection: 1,
    maximumSimultaneousSubscriptions: 1000,
    maximumLifetimeSubscriptions: 65535,
    connectionLifetimeMinutes: 1440,
    unsubscribeMethod: 'userDataStream.unsubscribe',
    omissionOfSubscriptionIdClosesAll: true,
    terminationEvent: 'eventStreamTerminated',
    abruptDisconnectTerminationEvent: 'UNKNOWN',
  });
  assert.deepEqual(contract('SPOT_SBE_PUBLIC_COMBINED_STREAM').responseSchema, {
    state: 'PINNED', revision: '3:5', sha256: '542776a038883dafe962341a041323ff5d8d3e36f1b860ab60156a88a4080bcf',
  });
  assert.deepEqual(contract('SPOT_ORDER_POST').rateLimit.claims.map(({ kind, value, condition }) => ({ kind, value, condition })), [
    { kind: 'REQUEST_WEIGHT', value: 0, condition: 'SUCCESS' },
    { kind: 'REQUEST_WEIGHT', value: 1, condition: 'FAILED' },
    { kind: 'ORDER_COUNT', value: 1, condition: 'ALWAYS' },
  ]);
  assert.deepEqual(contract('SPOT_TEST_ORDER_POST').rateLimit.claims.map(({ value, condition }) => ({ value, condition })), [
    { value: 1, condition: 'DEFAULT' }, { value: 20, condition: 'COMPUTE_COMMISSION_RATES_TRUE' },
  ]);
  assert.deepEqual(contract('USDM_ACCOUNT_V3').rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'IP', value: 5 }]);
  assert.equal(contract('USDM_BALANCE_V3').rateLimit.claims[0].value, 5);
  assert.equal(contract('USDM_POSITION_RISK_V3').rateLimit.claims[0].value, 5);
  assert.deepEqual(contract('USDM_ORDER_POST').rateLimit.claims.map(({ kind, interval, value }) => ({ kind, interval, value })), [
    { kind: 'REQUEST_WEIGHT', interval: 'REQUEST', value: 0 },
    { kind: 'ORDER_COUNT', interval: 'TEN_SECONDS', value: 1 },
    { kind: 'ORDER_COUNT', interval: 'MINUTE', value: 1 },
  ]);
  assert.deepEqual(contract('USDM_OPEN_ORDERS_QUERY').rateLimit.claims.map(({ value, condition }) => ({ value, condition })), [
    { value: 1, condition: 'WITH_SYMBOL' }, { value: 40, condition: 'WITHOUT_SYMBOL' },
  ]);
  assert.equal(contract('USDM_COUNTDOWN_CANCEL_ALL').rateLimit.claims[0].value, 10);
  assert.equal(contract('USDM_LISTEN_KEY_POST').connection.tokenLifetimeMinutes, 60);
  assert.deepEqual(contract('MARGIN_RISK_LISTEN_KEY_POST').rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'UID', value: 1 }]);
  assert.deepEqual(contract('MARGIN_RISK_LISTEN_KEY_PUT').rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'UID', value: 1 }]);
  assert.deepEqual(contract('MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT').rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'UID', value: 3000 }]);
  assert.equal(contract('MARGIN_BORROW_REPAY_POST').rateLimit.claims[0].value, 1500);
  assert.equal(contract('MARGIN_API_KEY_PERMISSIONS').rateLimit.claims[0].value, 1);
  for (const id of [
    'SPOT_ACCOUNT_API_TRADING_STATUS', 'USDM_ACCOUNT_API_TRADING_STATUS', 'MARGIN_ACCOUNT_API_TRADING_STATUS',
    'SPOT_ACCOUNT_STATUS', 'USDM_ACCOUNT_STATUS', 'MARGIN_ACCOUNT_STATUS',
  ]) {
    assert.deepEqual(contract(id).rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'IP', value: 1 }], id);
    assert.deepEqual(contract(id).authentication.requiredParameters, ['timestamp'], id);
  }
  for (const id of ['USDM_MULTI_ASSETS_MODE_QUERY', 'USDM_POSITION_MODE_QUERY']) {
    assert.deepEqual(contract(id).rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [{ scope: 'IP', value: 30 }], id);
    assert.deepEqual(contract(id).authentication.requiredParameters, ['timestamp'], id);
  }
  assert.deepEqual(BINANCE_CONTRACT_MATRIX.marginAccountModeFacts, {
    selectorParameter: 'isIsolated', falseOrOmittedMode: 'CROSS_MARGIN', trueMode: 'ISOLATED_MARGIN_PAIR',
    isolatedModeRequiresSymbol: true, portfolioMarginSupported: false,
  });
  assert.deepEqual(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.defaultProfiles, ['READ_KEY', 'EXECUTION_KEY']);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.combinedKeyPosture, 'OWNER_EXCEPTION_REQUIRED');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.fixedIpDeployedEgressMatch, 'REQUIRED');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.onlyRequiredProductPermissions, 'REQUIRED');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.accountFingerprintRealmMatch, 'REQUIRED');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.supportedOwnerApprovedModes, 'REQUIRED');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.requiredAccountStatusValue, 'Normal');
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.apiTradingLockedRequired, false);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.requiredUsdmMultiAssetsMarginValue, false);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.requiredUsdmDualSidePositionValue, false);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyProfilePolicy.unprovedBlocksLiveEntry, true);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyPermissionFields.includes('enableWithdrawals'), true);
  assert.equal(BINANCE_CONTRACT_MATRIX.apiKeyPermissionFields.includes('permitsUniversalTransfer'), true);
  assert.deepEqual(BINANCE_CONTRACT_MATRIX.unsupportedAccountModes, ['PORTFOLIO_MARGIN', 'MULTI_ASSETS', 'HEDGE_MODE']);
  assert.deepEqual(contract('MARGIN_ORDER_POST_SCOPE_CONFLICT').rateLimit.claims.map(({ scope, value, condition }) => ({ scope, value, condition })), [
    { scope: 'IP', value: 6, condition: 'CATALOG_SCOPE_LABEL_DEFAULT' },
    { scope: 'UID', value: 6, condition: 'CATALOG_VALUE_UNIT_DEFAULT' },
    { scope: 'IP', value: 1500, condition: 'CATALOG_SCOPE_LABEL_BORROW_SIDE_EFFECT' },
    { scope: 'UID', value: 1500, condition: 'CATALOG_VALUE_UNIT_BORROW_SIDE_EFFECT' },
  ]);
});

test('current Spot private WebSocket API subscription contracts match exactly', () => {
  for (const id of ['SPOT_WS_API_USER_DATA_SESSION', 'SPOT_WS_API_USER_DATA_SIGNATURE']) {
    const result = matchDocumentedBinanceContract(fixtureFromContract(contract(id)));
    assert.deepEqual(result, {
      ok: true,
      contractId: id,
      lifecycle: 'CURRENT',
      actionAuthority: 'NONE_RECORD_ONLY',
    });
    assert.equal(Object.isFrozen(result), true);
  }
});

test('obsolete Spot listen-key REST, WebSocket API, and private stream substitutions fail by name', async (t) => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    await t.test(`REST ${method}`, () => assertRejectedFixture({
      id: `OBSOLETE_SPOT_REST_${method}`,
      product: 'SPOT', environment: 'PRODUCTION', realm: 'PRIVATE_USER_DATA', transport: 'REST',
      baseUrl: 'https://api.binance.com',
      operation: { kind: 'REST_PATH', httpMethod: method, value: '/api/v3/userDataStream', queryTemplate: null },
    }, 'OBSOLETE_SPOT_PRIVATE_ROUTE'));
  }
  for (const method of ['userDataStream.start', 'userDataStream.ping', 'userDataStream.stop']) {
    await t.test(method, () => assertRejectedFixture({
      id: `OBSOLETE_${method.replaceAll('.', '_').toUpperCase()}`,
      product: 'SPOT', environment: 'PRODUCTION', realm: 'PRIVATE_USER_DATA', transport: 'WEBSOCKET_API',
      baseUrl: 'wss://ws-api.binance.com:443/ws-api/v3',
      operation: { kind: 'WS_METHOD', httpMethod: null, value: method, queryTemplate: null },
    }, 'OBSOLETE_SPOT_PRIVATE_ROUTE'));
  }
  assertRejectedFixture({
    id: 'OBSOLETE_SPOT_STREAM_LISTEN_KEY',
    product: 'SPOT', environment: 'PRODUCTION', realm: 'PRIVATE_USER_DATA', transport: 'WEBSOCKET_STREAM',
    baseUrl: 'wss://stream.binance.com:9443',
    operation: { kind: 'WS_PATH', httpMethod: null, value: '/ws/<listenKey>', queryTemplate: null },
  }, 'OBSOLETE_SPOT_PRIVATE_ROUTE');
});

test('current USD-M routed public, market, private, and listen-key lifecycle contracts match', () => {
  for (const id of [
    'USDM_WS_PUBLIC_RAW_STREAM',
    'USDM_WS_MARKET_RAW_STREAM',
    'USDM_WS_PRIVATE_USER_DATA',
    'USDM_LISTEN_KEY_POST',
    'USDM_LISTEN_KEY_PUT',
    'USDM_LISTEN_KEY_DELETE',
  ]) {
    const result = matchDocumentedBinanceContract(fixtureFromContract(contract(id)));
    assert.equal(result.ok, true, id);
    assert.equal(result.contractId, id);
    assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
  }
});

test('legacy unrouted USD-M private and market substitutions fail while routed tuples remain exact', () => {
  assertRejectedFixture({
    id: 'LEGACY_USDM_PRIVATE',
    product: 'USD_M_PERPETUAL', environment: 'PRODUCTION', realm: 'PRIVATE_USER_DATA', transport: 'WEBSOCKET_STREAM',
    baseUrl: 'wss://fstream.binance.com',
    operation: { kind: 'WS_PATH', httpMethod: null, value: '/ws/<listenKey>', queryTemplate: null },
  }, 'LEGACY_USDM_UNROUTED_WS');
  assertRejectedFixture({
    id: 'LEGACY_USDM_MARK_PRICE',
    product: 'USD_M_PERPETUAL', environment: 'PRODUCTION', realm: 'PUBLIC_MARKET', transport: 'WEBSOCKET_STREAM',
    baseUrl: 'wss://fstream.binance.com',
    operation: { kind: 'WS_PATH', httpMethod: null, value: '/ws/btcusdt@markPrice', queryTemplate: null },
  }, 'LEGACY_USDM_UNROUTED_WS');
  assertRejectedFixture({
    ...fixtureFromContract(contract('SPOT_WS_API_USER_DATA_SESSION')),
    id: 'CROSS_PRODUCT_SPOT_METHOD_AS_MARGIN',
    product: 'MARGIN',
  }, 'CROSS_PRODUCT_ROUTE_SUBSTITUTION');
});

test('Margin risk stream is separate from unresolved trade/account user data', () => {
  for (const id of ['MARGIN_RISK_LISTEN_KEY_POST', 'MARGIN_RISK_LISTEN_KEY_PUT', 'MARGIN_RISK_WS_RAW', 'MARGIN_RISK_WS_COMBINED']) {
    const result = matchDocumentedBinanceContract(fixtureFromContract(contract(id)));
    assert.equal(result.ok, true, id);
    assert.equal(result.contractId, id);
  }

  for (const id of ['MARGIN_RISK_LISTEN_KEY_DELETE_CONFLICT', 'MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT', 'MARGIN_ORDER_POST_SCOPE_CONFLICT']) {
    const result = assertRejectedFixture(fixtureFromContract(contract(id)), 'OFFICIAL_DOC_CONFLICT');
    assert.equal(result.contractId, id);
  }
  const tokenPost = contract('MARGIN_TRADE_LISTEN_TOKEN_POST_UNKNOWN');
  assertRejectedFixture(fixtureFromContract(tokenPost), 'DOCUMENTARY_CONTRACT_UNKNOWN');
  assert.equal(contract('MARGIN_TRADE_LISTEN_TOKEN_SUBSCRIBE_UNKNOWN').lifecycle, 'UNKNOWN');
  assert.equal(contract('MARGIN_TRADE_LISTEN_TOKEN_SUBSCRIBE_UNKNOWN').baseUrl, null);

  const maxBorrow = contract('MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT');
  assert.deepEqual(maxBorrow.rateLimit.claims.map(({ scope, value }) => ({ scope, value })), [
    { scope: 'UID', value: 750 },
    { scope: 'IP', value: 50 },
  ]);
});

test('documented Margin borrow/repay matches only as a no-authority source fact', () => {
  const result = matchDocumentedBinanceContract(fixtureFromContract(contract('MARGIN_BORROW_REPAY_POST')));
  assert.equal(result.ok, true);
  assert.equal(result.actionAuthority, 'NONE_RECORD_ONLY');
});

test('removed Margin userDataStream and isolated variants fail by name', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const path of ['/sapi/v1/userDataStream', '/sapi/v1/userDataStream/isolated']) {
      assertRejectedFixture({
        id: `OBSOLETE_MARGIN_${method}_${path.endsWith('isolated') ? 'ISOLATED' : 'CROSS'}`,
        product: 'MARGIN', environment: 'PRODUCTION', realm: 'PRIVATE_USER_DATA', transport: 'REST',
        baseUrl: 'https://api.binance.com',
        operation: { kind: 'REST_PATH', httpMethod: method, value: path, queryTemplate: null },
      }, 'OBSOLETE_MARGIN_PRIVATE_ROUTE');
    }
  }
});

test('unknown fields at every major level fail closed', () => {
  const targetAt = [
    (matrix) => matrix,
    (matrix) => matrix.sources[0],
    (matrix) => matrix.contracts[1],
    (matrix) => matrix.contracts[1].operation,
    (matrix) => matrix.contracts[1].authentication,
    (matrix) => matrix.contracts[1].rateLimit,
    (matrix) => matrix.contracts[1].rateLimit.claims[0],
    (matrix) => matrix.contracts[1].connection,
    (matrix) => matrix.contracts[1].responseSchema,
  ];
  for (const locate of targetAt) {
    const hostile = cloneMatrix(BINANCE_CONTRACT_MATRIX);
    addOwnDataProperty(locate(hostile), 'unregistered', true);
    assert.ok(issueCodes(validateBinanceContractMatrix(hostile)).includes('UNKNOWN_FIELD'));
  }

  assertRejectedFixture({
    ...fixtureFromContract(contract('SPOT_WS_API_USER_DATA_SESSION')),
    unregistered: true,
  }, 'FIXTURE_INVALID');
});

test('accessors, custom prototypes, sparse arrays, and non-JSON values are rejected without invocation', () => {
  let getterCalls = 0;
  const accessor = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  Object.defineProperty(accessor, 'revision', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'hostile';
    },
  });
  const accessorCodes = issueCodes(validateBinanceContractMatrix(accessor));
  assert.equal(getterCalls, 0);
  assert.ok(accessorCodes.includes('PROPERTY_DESCRIPTOR_INVALID'));

  const inherited = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  Object.setPrototypeOf(inherited.sources[0], { inherited: true });
  assert.ok(issueCodes(validateBinanceContractMatrix(inherited)).includes('OBJECT_PROTOTYPE_INVALID'));

  const sparse = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  delete sparse.sources[0].evidence[0];
  assert.ok(issueCodes(validateBinanceContractMatrix(sparse)).includes('ARRAY_SLOT_INVALID'));

  const functionValue = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  functionValue.contracts[0].notes = () => 'not JSON';
  assert.ok(issueCodes(validateBinanceContractMatrix(functionValue)).includes('JSON_TYPE_INVALID'));
});

test('top-level, nested, revoked, and fingerprint proxies fail without invoking traps', () => {
  let trapCalls = 0;
  const handler = {
    get() { trapCalls += 1; throw new Error('trap invoked'); },
    ownKeys() { trapCalls += 1; throw new Error('trap invoked'); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('trap invoked'); },
  };
  const top = new Proxy(cloneMatrix(BINANCE_CONTRACT_MATRIX), handler);
  assert.ok(issueCodes(validateBinanceContractMatrix(top)).includes('PROXY_FORBIDDEN'));
  assert.throws(() => fingerprintBinanceContractMatrix(top), /closed plain data/);

  const nested = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  nested.contracts[0].authentication = new Proxy(nested.contracts[0].authentication, handler);
  assert.ok(issueCodes(validateBinanceContractMatrix(nested)).includes('PROXY_FORBIDDEN'));

  const revoked = Proxy.revocable(cloneMatrix(BINANCE_CONTRACT_MATRIX), handler);
  revoked.revoke();
  assert.ok(issueCodes(validateBinanceContractMatrix(revoked.proxy)).includes('PROXY_FORBIDDEN'));
  assert.equal(trapCalls, 0);
});

test('hostile primitive coercion fields return issues instead of throwing', () => {
  for (const mutate of [
    (matrix) => { matrix.contracts[1].authentication.securityType = { toString: null, valueOf: null }; },
    (matrix) => { matrix.contracts[1].operation.kind = { toString: null, valueOf: null }; },
    (matrix) => { matrix.contracts[1].operation.httpMethod = { toString: null, valueOf: null }; },
    (matrix) => { matrix.contracts[1].rateLimit.claims[0].header = { toString: null, valueOf: null }; },
    (matrix) => { matrix.contracts[1].rateLimit.claims[0].condition = { toString: null, valueOf: null }; },
  ]) {
    const hostile = cloneMatrix(BINANCE_CONTRACT_MATRIX);
    mutate(hostile);
    assert.doesNotThrow(() => validateBinanceContractMatrix(hostile));
    assert.equal(validateBinanceContractMatrix(hostile).ok, false);
  }
});

test('non-applicable, selected mechanism, helper facts, and auth parameters cannot be collapsed', () => {
  const notApplicable = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const position = notApplicable.contracts.find((item) => item.id === 'SPOT_POSITION_ENDPOINT_NOT_APPLICABLE');
  position.baseUrl = 'https://api.binance.com';
  position.operation = { kind: 'REST_PATH', httpMethod: 'GET', value: '/api/v3/position', queryTemplate: null };
  notApplicable.contentSha256 = independentMatrixFingerprint(notApplicable);
  assert.ok(issueCodes(validateBinanceContractMatrix(notApplicable)).includes('NOT_APPLICABLE_CONTRACT_INCONSISTENT'));

  const selected = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  selected.selectedPrivateContractIds.SPOT = 'SPOT_WS_API_USER_DATA_SESSION';
  selected.contentSha256 = independentMatrixFingerprint(selected);
  assert.ok(issueCodes(validateBinanceContractMatrix(selected)).includes('PRIVATE_MECHANISM_SELECTION_INVALID'));

  const helper = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  helper.approvedProductBases['SPOT|PRODUCTION|REST'] = ['https://fapi.binance.com'];
  helper.contentSha256 = independentMatrixFingerprint(helper);
  assert.ok(issueCodes(validateBinanceContractMatrix(helper)).includes('APPROVED_BASES_INVALID'));

  const auth = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const signature = auth.contracts.find((item) => item.id === 'SPOT_WS_API_USER_DATA_SIGNATURE');
  signature.authentication.requiredParameters = ['timestamp'];
  auth.contentSha256 = independentMatrixFingerprint(auth);
  assert.ok(issueCodes(validateBinanceContractMatrix(auth)).includes('SIGNATURE_PARAMETERS_REQUIRED'));
});

test('source semantic dates and captured digest placeholders fail closed', () => {
  const date = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  date.sources[0].lastModified = '2026-02-30';
  date.sources[0].evidenceSha256 = independentSourceFingerprint(date.sources[0]);
  assert.ok(issueCodes(validateBinanceContractMatrix(date)).includes('LAST_MODIFIED_INVALID'));

  const zero = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  zero.sources[0].sourceContentSha256 = '0'.repeat(64);
  zero.sources[0].evidenceSha256 = independentSourceFingerprint(zero.sources[0]);
  assert.ok(issueCodes(validateBinanceContractMatrix(zero)).includes('SOURCE_CONTENT_PROOF_REQUIRED'));

  const schema = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const sbe = schema.contracts.find((item) => item.id === 'SPOT_SBE_PUBLIC_RAW_STREAM');
  sbe.responseSchema.sha256 = '1'.repeat(64);
  assert.ok(issueCodes(validateBinanceContractMatrix(schema)).includes('PINNED_SCHEMA_SOURCE_MISMATCH'));
});

test('missing source check time and evidence/content hashes fail closed', () => {
  for (const key of ['checkedAt', 'evidenceSha256', 'sourceContentSha256']) {
    const hostile = cloneMatrix(BINANCE_CONTRACT_MATRIX);
    delete hostile.sources[0][key];
    assert.ok(issueCodes(validateBinanceContractMatrix(hostile)).includes('MISSING_FIELD'), key);
  }
});

test('rate claims reject foreign sources, zero order counts, unknown claims, collapsed conflicts, and wrong dimensions', () => {
  const foreign = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const spotOrder = foreign.contracts.find((item) => item.id === 'SPOT_ORDER_POST');
  spotOrder.rateLimit.claims[0].sourceId = 'MARGIN_TRADE_CATALOG_2026_07_12';
  assert.ok(issueCodes(validateBinanceContractMatrix(foreign)).includes('RATE_SOURCE_NOT_CONTRACT_SOURCE'));

  const zeroOrder = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const usdmOrder = zeroOrder.contracts.find((item) => item.id === 'USDM_ORDER_POST');
  usdmOrder.rateLimit.claims.find((claim) => claim.kind === 'ORDER_COUNT').value = 0;
  assert.ok(issueCodes(validateBinanceContractMatrix(zeroOrder)).includes('RATE_VALUE_INVALID'));

  const unknown = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const testOrder = unknown.contracts.find((item) => item.id === 'USDM_TEST_ORDER_POST');
  testOrder.rateLimit.claims.push(structuredClone(usdmOrder.rateLimit.claims[0]));
  assert.ok(issueCodes(validateBinanceContractMatrix(unknown)).includes('UNKNOWN_RATE_HAS_CLAIMS'));

  const conflict = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const maxBorrow = conflict.contracts.find((item) => item.id === 'MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT');
  maxBorrow.rateLimit.claims = [maxBorrow.rateLimit.claims[0]];
  assert.ok(issueCodes(validateBinanceContractMatrix(conflict)).includes('CONFLICT_RATE_EVIDENCE_INSUFFICIENT'));

  const dimension = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const stream = dimension.contracts.find((item) => item.id === 'USDM_WS_PUBLIC_RAW_STREAM');
  stream.rateLimit.claims[0].scope = 'IP';
  assert.ok(issueCodes(validateBinanceContractMatrix(dimension)).includes('MESSAGE_LIMIT_DIMENSION_INVALID'));
});

test('duplicate contract IDs are rejected independently of semantic duplication', () => {
  const hostile = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const copy = structuredClone(hostile.contracts[0]);
  copy.operation = { kind: 'REST_PATH', httpMethod: 'GET', value: '/api/v3/time', queryTemplate: null };
  hostile.contracts.push(copy);
  assert.ok(issueCodes(validateBinanceContractMatrix(hostile)).includes('DUPLICATE_CONTRACT_ID'));
});

test('cross-environment, combined-query, and proxy fixture substitutions fail closed', () => {
  const spot = fixtureFromContract(contract('SPOT_WS_API_USER_DATA_SIGNATURE'));
  assertRejectedFixture({ ...spot, id: 'CROSS_ENVIRONMENT_SPOT', environment: 'DEMO' }, 'CROSS_ENVIRONMENT_ROUTE_SUBSTITUTION');

  const combined = fixtureFromContract(contract('USDM_WS_PUBLIC_COMBINED_STREAM'));
  assertRejectedFixture({
    ...combined,
    id: 'ALTERED_COMBINED_QUERY',
    operation: { ...combined.operation, queryTemplate: 'streams=<streamName1>' },
  }, 'UNREGISTERED_DOCUMENTARY_CONTRACT');

  let trapCalls = 0;
  const proxied = new Proxy(spot, {
    get() { trapCalls += 1; throw new Error('fixture trap'); },
    ownKeys() { trapCalls += 1; throw new Error('fixture trap'); },
  });
  assertRejectedFixture(proxied, 'FIXTURE_INVALID');
  assert.equal(trapCalls, 0);
});

test('duplicate IDs, URLs, source values, rate claims, and semantic contracts fail', () => {
  const duplicateSource = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  duplicateSource.sources[1].id = duplicateSource.sources[0].id;
  duplicateSource.sources[1].officialUrl = duplicateSource.sources[0].officialUrl;
  duplicateSource.sources[1].evidenceSha256 = independentSourceFingerprint(duplicateSource.sources[1]);
  const sourceCodes = issueCodes(validateBinanceContractMatrix(duplicateSource));
  assert.ok(sourceCodes.includes('DUPLICATE_SOURCE_ID'));
  assert.ok(sourceCodes.includes('DUPLICATE_SOURCE_URL'));

  const duplicateContract = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const copy = structuredClone(duplicateContract.contracts[0]);
  copy.id = 'SEMANTIC_DUPLICATE_DIFFERENT_ID';
  duplicateContract.contracts.push(copy);
  assert.ok(issueCodes(validateBinanceContractMatrix(duplicateContract)).includes('DUPLICATE_SEMANTIC_CONTRACT'));

  const duplicateRequired = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  duplicateRequired.contracts[1].authentication.requiredParameters.push('timestamp', 'timestamp');
  assert.ok(issueCodes(validateBinanceContractMatrix(duplicateRequired)).includes('DUPLICATE_ARRAY_VALUE'));

  const duplicateClaim = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const maxBorrow = duplicateClaim.contracts.find((item) => item.id === 'MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT');
  maxBorrow.rateLimit.claims[1] = structuredClone(maxBorrow.rateLimit.claims[0]);
  const claimCodes = issueCodes(validateBinanceContractMatrix(duplicateClaim));
  assert.ok(claimCodes.includes('DUPLICATE_RATE_CLAIM'));
  assert.ok(claimCodes.includes('MARGIN_MAX_BORROWABLE_CONFLICT_COLLAPSED'));
});

test('non-official, mutable, malformed, query, fragment, and lookalike provenance URLs fail', async (t) => {
  const invalidUrls = [
    'http://developers.binance.com/en/docs/products/spot/rest-api',
    'https://developers.binance.com.evil/en/docs/products/spot/rest-api',
    'https://developers.binance.com/en/docs/products/spot/rest-api?mutable=1',
    'https://developers.binance.com/en/docs/products/spot/rest-api#fragment',
    'https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md',
    'https://example.com/binance-docs',
  ];
  for (const [index, url] of invalidUrls.entries()) {
    await t.test(String(index), () => {
      const matrix = cloneMatrix(BINANCE_CONTRACT_MATRIX);
      matrix.sources[0].officialUrl = url;
      matrix.sources[0].evidenceSha256 = independentSourceFingerprint(matrix.sources[0]);
      assert.ok(issueCodes(validateBinanceContractMatrix(matrix)).includes('OFFICIAL_URL_INVALID'));
    });
  }
});

test('source evidence and whole-matrix hash mutations are detected independently', () => {
  const evidenceDrift = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  evidenceDrift.sources[0].evidence[0] += ' drift';
  assert.ok(issueCodes(validateBinanceContractMatrix(evidenceDrift)).includes('EVIDENCE_SHA256_MISMATCH'));

  const hashDrift = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  hashDrift.contentSha256 = '0'.repeat(64);
  const driftCodes = issueCodes(validateBinanceContractMatrix(hashDrift));
  assert.ok(driftCodes.includes('MATRIX_SHA256_MISMATCH'));
  assert.ok(driftCodes.includes('MATRIX_NOT_HASH_LOCKED'));

  const recomputedButUnapproved = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  recomputedButUnapproved.contracts[0].notes += ' changed';
  recomputedButUnapproved.contentSha256 = independentMatrixFingerprint(recomputedButUnapproved);
  const recomputedCodes = issueCodes(validateBinanceContractMatrix(recomputedButUnapproved));
  assert.equal(recomputedCodes.includes('MATRIX_SHA256_MISMATCH'), false);
  assert.ok(recomputedCodes.includes('MATRIX_NOT_HASH_LOCKED'));
});

test('Margin conflicts cannot be collapsed even when a hostile matrix is rehashed', () => {
  const maxBorrow = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const maxRecord = maxBorrow.contracts.find((item) => item.id === 'MARGIN_MAX_BORROWABLE_WEIGHT_CONFLICT');
  maxRecord.lifecycle = 'CURRENT';
  maxRecord.ambiguityClass = 'NONE';
  maxRecord.rateLimit.state = 'VERIFIED';
  maxRecord.rateLimit.claims = [maxRecord.rateLimit.claims[0]];
  maxBorrow.contentSha256 = independentMatrixFingerprint(maxBorrow);
  const maxCodes = issueCodes(validateBinanceContractMatrix(maxBorrow));
  assert.ok(maxCodes.includes('MARGIN_MAX_BORROWABLE_CONFLICT_COLLAPSED'));
  assert.ok(maxCodes.includes('MATRIX_NOT_HASH_LOCKED'));

  const privateMechanism = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const token = privateMechanism.contracts.find((item) => item.id === 'MARGIN_TRADE_LISTEN_TOKEN_POST_UNKNOWN');
  token.lifecycle = 'CURRENT';
  token.ambiguityClass = 'NONE';
  token.authentication.securityType = 'USER_STREAM';
  privateMechanism.contentSha256 = independentMatrixFingerprint(privateMechanism);
  const privateCodes = issueCodes(validateBinanceContractMatrix(privateMechanism));
  assert.ok(privateCodes.includes('MARGIN_LISTEN_TOKEN_UNKNOWN_COLLAPSED'));
  assert.ok(privateCodes.includes('MATRIX_NOT_HASH_LOCKED'));
});

test('cross-product bases, product/source substitutions, unknown enums, and inconsistent bounds fail', () => {
  const crossBase = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  crossBase.contracts[0].baseUrl = 'https://fapi.binance.com';
  assert.ok(issueCodes(validateBinanceContractMatrix(crossBase)).includes('CROSS_PRODUCT_BASE_URL'));

  const walletScope = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  const usdmWallet = walletScope.contracts.find((item) => item.id === 'USDM_API_KEY_PERMISSIONS');
  usdmWallet.operation.value = '/sapi/v1/account/unreviewed';
  const walletScopeCodes = issueCodes(validateBinanceContractMatrix(walletScope));
  assert.ok(walletScopeCodes.includes('CROSS_PRODUCT_BASE_URL'));
  assert.ok(walletScopeCodes.includes('USDM_WALLET_BASE_SCOPE_VIOLATION'));

  const crossSource = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  crossSource.contracts[0].sourceIds = ['MARGIN_CHANGELOG_2026_07_10'];
  assert.ok(issueCodes(validateBinanceContractMatrix(crossSource)).includes('SOURCE_PRODUCT_MISMATCH'));

  const unknownEnum = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  unknownEnum.contracts[0].lifecycle = 'AVAILABLE';
  assert.ok(issueCodes(validateBinanceContractMatrix(unknownEnum)).includes('ENUM_INVALID'));

  const reversed = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  reversed.contracts[0].authentication.recvWindowDefaultMs = 60001;
  assert.ok(issueCodes(validateBinanceContractMatrix(reversed)).includes('RECV_WINDOW_BOUNDS_REVERSED'));

  const float = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  float.contracts[0].connection.connectionLifetimeMinutes = 1.5;
  assert.ok(issueCodes(validateBinanceContractMatrix(float)).includes('NUMBER_INVALID'));

  const fabricatedSchema = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  fabricatedSchema.contracts[0].responseSchema.sha256 = '0'.repeat(64);
  assert.ok(issueCodes(validateBinanceContractMatrix(fabricatedSchema)).includes('UNKNOWN_SCHEMA_HAS_VALUE'));
});

test('validation is deterministic, does not mutate input, and does not retain failed state', () => {
  const invalid = cloneMatrix(BINANCE_CONTRACT_MATRIX);
  invalid.contracts[0].lifecycle = 'AVAILABLE';
  invalid.sources[0].officialUrl = 'https://example.com';
  const before = structuredClone(invalid);
  const first = validateBinanceContractMatrix(invalid);
  const second = validateBinanceContractMatrix(invalid);
  assert.deepEqual(first, second);
  assert.deepEqual(invalid, before);

  const validAfterFailure = validateBinanceContractMatrix(BINANCE_CONTRACT_MATRIX);
  assert.equal(validAfterFailure.ok, true);
  if (!first.ok) {
    const sorted = [...first.issues].sort((left, right) => codePointCompare(`${left.path}|${left.code}`, `${right.path}|${right.code}`));
    assert.deepEqual(first.issues, sorted);
    assertDeeplyFrozen(assert, first);
  }
});

test('fixture validation rejects malformed, inherited, accessor, host, path, query, and realm variants', () => {
  const canonical = fixtureFromContract(contract('SPOT_WS_API_USER_DATA_SESSION'));
  assertRejectedFixture({ ...canonical, extra: true }, 'FIXTURE_INVALID');

  const inherited = Object.create({ inherited: true });
  Object.assign(inherited, canonical);
  assertRejectedFixture(inherited, 'FIXTURE_INVALID');

  let getterCalls = 0;
  const accessor = { ...canonical };
  Object.defineProperty(accessor, 'baseUrl', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return canonical.baseUrl;
    },
  });
  assertRejectedFixture(accessor, 'FIXTURE_INVALID');
  assert.equal(getterCalls, 0);

  for (const overrides of [
    { baseUrl: `${canonical.baseUrl}/` },
    { baseUrl: `${canonical.baseUrl}?x=1` },
    { baseUrl: canonical.baseUrl.replace('wss://', 'ws://') },
    { realm: 'PUBLIC_MARKET' },
    { operation: { ...canonical.operation, value: `${canonical.operation.value}/` } },
  ]) {
    assertRejectedFixture({ ...canonical, id: 'HOSTILE_EXACTNESS_VARIANT', ...overrides }, 'UNREGISTERED_DOCUMENTARY_CONTRACT');
  }
});
