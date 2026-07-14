export function cloneMatrix(matrix) {
  return structuredClone(matrix);
}

export function fixtureFromContract(contract, overrides = {}) {
  return {
    id: `FIXTURE_${contract.id}`,
    product: contract.product,
    environment: contract.environment,
    realm: contract.realm,
    transport: contract.transport,
    baseUrl: contract.baseUrl,
    operation: structuredClone(contract.operation),
    ...overrides,
  };
}

export function addOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return target;
}

export function assertDeeplyFrozen(assert, value) {
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

/** Hand-authored tuples copied from the checked official pages, never from the matrix. */
export const CHECKED_BINANCE_ROUTE_FIXTURES = Object.freeze([
  ['SPOT_WS_API_USER_DATA_SIGNATURE', 'SPOT', 'PRODUCTION', 'PRIVATE_USER_DATA', 'WEBSOCKET_API', 'wss://ws-api.binance.com:443/ws-api/v3', 'WS_METHOD', null, 'userDataStream.subscribe.signature', null],
  ['SPOT_PUBLIC_COMBINED_STREAM', 'SPOT', 'PRODUCTION', 'PUBLIC_MARKET', 'WEBSOCKET_STREAM', 'wss://stream.binance.com:9443', 'WS_PATH', null, '/stream', 'streams=<streamName1>/<streamName2>'],
  ['SPOT_SBE_PUBLIC_COMBINED_STREAM', 'SPOT', 'PRODUCTION', 'PUBLIC_MARKET', 'WEBSOCKET_STREAM', 'wss://stream-sbe.binance.com:9443', 'WS_PATH', null, '/stream', 'streams=<streamName1>/<streamName2>'],
  ['SPOT_SERVER_TIME', 'SPOT', 'PRODUCTION', 'PUBLIC_REST', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/api/v3/time', null],
  ['SPOT_ORDER_POST', 'SPOT', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://api.binance.com', 'REST_PATH', 'POST', '/api/v3/order', null],
  ['SPOT_TEST_ORDER_POST', 'SPOT', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://api.binance.com', 'REST_PATH', 'POST', '/api/v3/order/test', null],
  ['SPOT_API_KEY_PERMISSIONS', 'SPOT', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiRestrictions', null],
  ['SPOT_ACCOUNT_API_TRADING_STATUS', 'SPOT', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiTradingStatus', null],
  ['SPOT_ACCOUNT_STATUS', 'SPOT', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/status', null],
  ['SPOT_DEMO_WS_USER_DATA_SIGNATURE', 'SPOT', 'DEMO', 'PRIVATE_USER_DATA', 'WEBSOCKET_API', 'wss://demo-ws-api.binance.com/ws-api/v3', 'WS_METHOD', null, 'userDataStream.subscribe.signature', null],
  ['SPOT_TESTNET_WS_PUBLIC_RAW', 'SPOT', 'TESTNET', 'PUBLIC_MARKET', 'WEBSOCKET_STREAM', 'wss://stream.testnet.binance.vision:9443', 'WS_PATH', null, '/ws/<streamName>', null],
  ['USDM_WS_PUBLIC_COMBINED_STREAM', 'USD_M_PERPETUAL', 'PRODUCTION', 'PUBLIC_MARKET', 'WEBSOCKET_STREAM', 'wss://fstream.binance.com/public', 'WS_PATH', null, '/stream', 'streams=<streamName1>/<streamName2>'],
  ['USDM_WS_MARKET_RAW_STREAM', 'USD_M_PERPETUAL', 'PRODUCTION', 'PUBLIC_MARKET', 'WEBSOCKET_STREAM', 'wss://fstream.binance.com/market', 'WS_PATH', null, '/ws/<streamName>', null],
  ['USDM_WS_PRIVATE_USER_DATA_QUERY_RAW', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_USER_DATA', 'WEBSOCKET_STREAM', 'wss://fstream.binance.com/private', 'WS_PATH', null, '/ws', 'listenKey=<listenKey>'],
  ['USDM_LISTEN_KEY_POST', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_USER_DATA', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'POST', '/fapi/v1/listenKey', null],
  ['USDM_SERVER_TIME', 'USD_M_PERPETUAL', 'PRODUCTION', 'PUBLIC_REST', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v1/time', null],
  ['USDM_DEPTH_SNAPSHOT', 'USD_M_PERPETUAL', 'PRODUCTION', 'PUBLIC_REST', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v1/depth', null],
  ['USDM_ACCOUNT_V3', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v3/account', null],
  ['USDM_POSITION_RISK_V3', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v3/positionRisk', null],
  ['USDM_ORDER_POST', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'POST', '/fapi/v1/order', null],
  ['USDM_TEST_ORDER_POST', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'POST', '/fapi/v1/order/test', null],
  ['USDM_ORDER_QUERY', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v1/order', null],
  ['USDM_ORDER_CANCEL', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'DELETE', '/fapi/v1/order', null],
  ['USDM_COUNTDOWN_CANCEL_ALL', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'POST', '/fapi/v1/countdownCancelAll', null],
  ['USDM_API_KEY_PERMISSIONS', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiRestrictions', null],
  ['USDM_ACCOUNT_API_TRADING_STATUS', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiTradingStatus', null],
  ['USDM_ACCOUNT_STATUS', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/status', null],
  ['USDM_MULTI_ASSETS_MODE_QUERY', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v1/multiAssetsMargin', null],
  ['USDM_POSITION_MODE_QUERY', 'USD_M_PERPETUAL', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://fapi.binance.com', 'REST_PATH', 'GET', '/fapi/v1/positionSide/dual', null],
  ['USDM_DEMO_REST_BASE', 'USD_M_PERPETUAL', 'DEMO', 'PUBLIC_REST', 'REST', 'https://demo-fapi.binance.com', 'BASE', null, '/', null],
  ['USDM_WS_API_TESTNET_BASE', 'USD_M_PERPETUAL', 'TESTNET', 'PRIVATE_TRADE', 'WEBSOCKET_API', 'wss://testnet.binancefuture.com/ws-fapi/v1', 'BASE', null, '/', null],
  ['MARGIN_SERVER_TIME', 'MARGIN', 'PRODUCTION', 'PUBLIC_REST', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/api/v3/time', null],
  ['MARGIN_CROSS_ACCOUNT_BALANCES', 'MARGIN', 'PRODUCTION', 'PRIVATE_MARGIN_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/margin/account', null],
  ['MARGIN_ORDER_QUERY', 'MARGIN', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/margin/order', null],
  ['MARGIN_ORDER_CANCEL', 'MARGIN', 'PRODUCTION', 'PRIVATE_TRADE', 'REST', 'https://api.binance.com', 'REST_PATH', 'DELETE', '/sapi/v1/margin/order', null],
  ['MARGIN_BORROW_REPAY_POST', 'MARGIN', 'PRODUCTION', 'PRIVATE_MARGIN_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'POST', '/sapi/v1/margin/borrow-repay', null],
  ['MARGIN_RISK_LISTEN_KEY_POST', 'MARGIN', 'PRODUCTION', 'PRIVATE_RISK_DATA', 'REST', 'https://api.binance.com', 'REST_PATH', 'POST', '/sapi/v1/margin/listen-key', null],
  ['MARGIN_RISK_LISTEN_KEY_PUT', 'MARGIN', 'PRODUCTION', 'PRIVATE_RISK_DATA', 'REST', 'https://api.binance.com', 'REST_PATH', 'PUT', '/sapi/v1/margin/listen-key', null],
  ['MARGIN_RISK_WS_RAW', 'MARGIN', 'PRODUCTION', 'PRIVATE_RISK_DATA', 'WEBSOCKET_STREAM', 'wss://margin-stream.binance.com', 'WS_PATH', null, '/ws/<listenKey>', null],
  ['MARGIN_RISK_WS_COMBINED', 'MARGIN', 'PRODUCTION', 'PRIVATE_RISK_DATA', 'WEBSOCKET_STREAM', 'wss://margin-stream.binance.com', 'WS_PATH', null, '/stream', 'streams=<listenKey>'],
  ['MARGIN_API_KEY_PERMISSIONS', 'MARGIN', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiRestrictions', null],
  ['MARGIN_ACCOUNT_API_TRADING_STATUS', 'MARGIN', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/apiTradingStatus', null],
  ['MARGIN_ACCOUNT_STATUS', 'MARGIN', 'PRODUCTION', 'PRIVATE_ACCOUNT', 'REST', 'https://api.binance.com', 'REST_PATH', 'GET', '/sapi/v1/account/status', null],
].map(([expectedContractId, product, environment, realm, transport, baseUrl, kind, httpMethod, value, queryTemplate]) => Object.freeze({
  expectedContractId,
  fixture: Object.freeze({
    id: `CHECKED_${expectedContractId}`,
    product,
    environment,
    realm,
    transport,
    baseUrl,
    operation: Object.freeze({ kind, httpMethod, value, queryTemplate }),
  }),
})));
