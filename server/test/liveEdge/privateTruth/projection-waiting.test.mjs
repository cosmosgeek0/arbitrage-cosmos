import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  createInitialMarginRiskLifecycleState,
  createInitialSpotPrivateLifecycleState,
  createPrivateLifecycleWitness,
  createSpotRealmBoundRevision,
  createWaitingPrivateTruthBinding,
  decideWaitingPrivateTruth,
  derivePrivateTruthSourceCutRevision,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  reduceSpotPrivateLifecycle,
  resolvePrivateFactContract,
  validatePrivateTruthProjection,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const MATRIX_SHA = '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac';
const FACT_SCHEMA = 'L05_BINANCE_PRIVATE_FACT_V1';
const PROJECTION_SCHEMA = 'L05_BINANCE_PRIVATE_PROJECTION_V1';
const ACCOUNT_REALM = 'realm-production-primary';
const EVALUATED_AT_MS = 1_800_000_000_000;
const EXPECTED_VALID_UNTIL_MS = EVALUATED_AT_MS + 900;
const SPOT_EVENT_CONTENT_REVISION = 'spot_content_00000000000000000000000000000001';
const SPOT_EVENT_REVISION = createSpotRealmBoundRevision('spot_event', ACCOUNT_REALM, {
  generation: 1,
  eventKind: 'ACCOUNT',
  contentRevision: SPOT_EVENT_CONTENT_REVISION,
  exchangeEventTimeMs: EVALUATED_AT_MS - 200,
  receiptTimeMs: EVALUATED_AT_MS - 150,
});
const READ_PROFILE_ID = 'profile-read-v1';
const EXECUTION_PROFILE_ID = 'profile-execution-v1';
const READ_PERMISSION_REVISION = 'permission-read-v1';
const EXECUTION_PERMISSION_REVISION = 'permission-execution-v1';
const RECONCILIATION_RESULT_REVISION = `foundation-reconciliation-result:${'a'.repeat(24)}`;
const SPOT_RECONCILIATION_REVISION = createSpotRealmBoundRevision(
  'spot_rest',
  ACCOUNT_REALM,
  {
    generation: 1,
    reconciledAtMs: EVALUATED_AT_MS,
    validUntilMs: EXPECTED_VALID_UNTIL_MS,
    throughEventRevision: SPOT_EVENT_REVISION,
    throughExchangeEventTimeMs: EVALUATED_AT_MS - 200,
  },
);
const USDM_RECONCILIATION_REVISION = 'usdm_rest_00000000000000000000000000000011';
const INSTRUMENT_REVISION = `l04-instrument-spec:${'1'.repeat(24)}`;
const INSTRUMENT_EVIDENCE_REVISION = `l04-instrument-source-evidence:${'2'.repeat(24)}`;
const INSTRUMENT_SNAPSHOT_REVISION = `l04-instrument-registry-snapshot:${'3'.repeat(24)}`;
const FOREIGN_RECONCILIATION_CUT_REVISION = `l05pcut_${'f'.repeat(64)}`;
const FOREIGN_READ_PERMISSION_REVISION = `l05perm_${'d'.repeat(64)}`;
const FOREIGN_EXECUTION_PERMISSION_REVISION = `l05perm_${'e'.repeat(64)}`;

const NO_AUTHORITY = Object.freeze({
  sendEligible: false,
  accountReadAuthority: 'NONE',
  mutationAuthority: 'NONE',
  reconciliationAuthority: 'NONE',
  capitalAuthority: 'NONE',
  riskAuthority: 'NONE',
  externalActionAuthorization: 'NONE',
  actionAuthority: 'NONE_RECORD_ONLY',
});

const REQUIRED = Object.freeze({
  SPOT: Object.freeze([
    'SPOT_PERMISSIONS', 'SPOT_ACCOUNT', 'SPOT_OPEN_ORDERS', 'SPOT_TRADES',
    'SPOT_COMMISSIONS', 'SPOT_ACCOUNT_STATUS', 'SPOT_TRADING_STATUS',
  ]),
  USD_M_PERPETUAL: Object.freeze([
    'USDM_PERMISSIONS', 'USDM_ACCOUNT', 'USDM_BALANCE', 'USDM_POSITIONS',
    'USDM_OPEN_ORDERS', 'USDM_ALGO_OPEN_ORDERS', 'USDM_TRADES',
    'USDM_COMMISSIONS', 'USDM_INCOME',
    'USDM_ADL', 'USDM_ACCOUNT_CONFIGURATION', 'USDM_SYMBOL_CONFIGURATION',
    'USDM_ACCOUNT_STATUS', 'USDM_TRADING_STATUS',
    'USDM_MULTI_ASSETS_MODE', 'USDM_POSITION_MODE',
  ]),
  MARGIN: Object.freeze([
    'MARGIN_PERMISSIONS', 'MARGIN_CROSS_ACCOUNT', 'MARGIN_OPEN_ORDERS',
    'MARGIN_TRADES', 'MARGIN_INTEREST', 'MARGIN_INTEREST_RATE',
    'MARGIN_INVENTORY', 'MARGIN_MAX_BORROWABLE',
    'MARGIN_BORROW_REPAY_HISTORY', 'MARGIN_ACCOUNT_STATUS', 'MARGIN_TRADING_STATUS',
  ]),
});

const CONTRACT_IDS = Object.freeze({
  SPOT_PERMISSIONS: 'SPOT_API_KEY_PERMISSIONS',
  SPOT_ACCOUNT: 'SPOT_ACCOUNT_BALANCES',
  SPOT_OPEN_ORDERS: 'SPOT_OPEN_ORDERS_QUERY',
  SPOT_TRADES: 'SPOT_MY_TRADES_QUERY',
  SPOT_COMMISSIONS: 'SPOT_COMMISSION_QUERY',
  SPOT_ACCOUNT_STATUS: 'SPOT_ACCOUNT_STATUS',
  SPOT_TRADING_STATUS: 'SPOT_ACCOUNT_API_TRADING_STATUS',
  USDM_PERMISSIONS: 'USDM_API_KEY_PERMISSIONS',
  USDM_ACCOUNT: 'USDM_ACCOUNT_V3',
  USDM_BALANCE: 'USDM_BALANCE_V3',
  USDM_POSITIONS: 'USDM_POSITION_RISK_V3',
  USDM_OPEN_ORDERS: 'USDM_OPEN_ORDERS_QUERY',
  USDM_ALGO_OPEN_ORDERS: null,
  USDM_TRADES: 'USDM_USER_TRADES_QUERY',
  USDM_COMMISSIONS: null,
  USDM_INCOME: null,
  USDM_ADL: null,
  USDM_ACCOUNT_CONFIGURATION: null,
  USDM_SYMBOL_CONFIGURATION: null,
  USDM_ACCOUNT_STATUS: 'USDM_ACCOUNT_STATUS',
  USDM_TRADING_STATUS: 'USDM_ACCOUNT_API_TRADING_STATUS',
  USDM_MULTI_ASSETS_MODE: 'USDM_MULTI_ASSETS_MODE_QUERY',
  USDM_POSITION_MODE: 'USDM_POSITION_MODE_QUERY',
  MARGIN_PERMISSIONS: 'MARGIN_API_KEY_PERMISSIONS',
  MARGIN_CROSS_ACCOUNT: 'MARGIN_CROSS_ACCOUNT_BALANCES',
  MARGIN_OPEN_ORDERS: 'MARGIN_OPEN_ORDERS_QUERY',
  MARGIN_TRADES: 'MARGIN_MY_TRADES_QUERY',
  MARGIN_INTEREST: 'MARGIN_INTEREST_HISTORY_QUERY',
  MARGIN_INTEREST_RATE: 'MARGIN_INTEREST_RATE_HISTORY_QUERY',
  MARGIN_INVENTORY: 'MARGIN_AVAILABLE_INVENTORY_QUERY',
  MARGIN_MAX_BORROWABLE: null,
  MARGIN_BORROW_REPAY_HISTORY: null,
  MARGIN_ACCOUNT_STATUS: 'MARGIN_ACCOUNT_STATUS',
  MARGIN_TRADING_STATUS: 'MARGIN_ACCOUNT_API_TRADING_STATUS',
});

const GAP_REASONS = Object.freeze({
  USDM_ALGO_OPEN_ORDERS: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS',
  USDM_COMMISSIONS: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_COMMISSION',
  USDM_INCOME: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_INCOME',
  USDM_ADL: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ADL',
  USDM_ACCOUNT_CONFIGURATION: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ACCOUNT_CONFIGURATION',
  USDM_SYMBOL_CONFIGURATION: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_SYMBOL_CONFIGURATION',
  MARGIN_MAX_BORROWABLE: 'OFFICIAL_DOC_CONFLICT_MARGIN_MAX_BORROWABLE_WEIGHT',
  MARGIN_BORROW_REPAY_HISTORY: 'OFFICIAL_DOC_CONFLICT_MARGIN_BORROW_REPAY_HISTORY_PARAMETERS',
});

function productFor(kind) {
  if (kind.startsWith('SPOT_')) return 'SPOT';
  if (kind.startsWith('USDM_')) return 'USD_M_PERPETUAL';
  return 'MARGIN';
}

function queryMetadata(kind, isGap = false) {
  if (isGap) return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
  if (['SPOT_OPEN_ORDERS', 'USDM_OPEN_ORDERS'].includes(kind)) {
    return { queryScope: 'ALL_SYMBOLS', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_OPEN_ORDERS') {
    return { queryScope: 'ALL_SYMBOLS', querySymbol: null, queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  if (['SPOT_TRADES', 'SPOT_COMMISSIONS', 'USDM_TRADES'].includes(kind)) {
    return { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', queryAsset: null, queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_TRADES') {
    return { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT', queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  if (kind === 'MARGIN_INTEREST_RATE') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: 'USDT', queryType: null, marginMode: null };
  }
  if (kind === 'MARGIN_INTEREST') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: 'CROSS' };
  }
  if (kind === 'MARGIN_INVENTORY') {
    return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: 'MARGIN', marginMode: null };
  }
  return { queryScope: 'ACCOUNT_WIDE', querySymbol: null, queryAsset: null, queryType: null, marginMode: null };
}

const NULL_QUERY_COVERAGE = Object.freeze({
  omitZeroBalances: null,
  startTimeMs: null,
  endTimeMs: null,
  limit: null,
  orderId: null,
  fromId: null,
  cursor: null,
  page: null,
  size: null,
  vipLevel: null,
  isolatedSymbol: null,
});

function queryCoverage(kind, isGap = false, sourceTimeMs = EVALUATED_AT_MS - 100) {
  if (isGap) return { kind: 'UNAVAILABLE_GAP', ...NULL_QUERY_COVERAGE };
  if (kind === 'SPOT_ACCOUNT') {
    return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE, omitZeroBalances: false };
  }
  if (['SPOT_TRADES', 'USDM_TRADES', 'MARGIN_TRADES'].includes(kind)) {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: sourceTimeMs - 60_000,
      endTimeMs: sourceTimeMs,
      limit: 1_000,
    };
  }
  if (kind === 'MARGIN_INTEREST') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: sourceTimeMs - 60_000,
      endTimeMs: sourceTimeMs,
      page: 1,
      size: 100,
    };
  }
  if (kind === 'MARGIN_INTEREST_RATE') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: sourceTimeMs - 60_000,
      endTimeMs: sourceTimeMs,
    };
  }
  return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE };
}

const RATE = Object.freeze({ maker: '0.001', taker: '0.001', buyer: '0', seller: '0' });

function permissionValue(profileId, posture) {
  const read = profileId === READ_PROFILE_ID;
  return {
    ipRestrict: true,
    createTime: EVALUATED_AT_MS - 10_000,
    enableReading: read,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: !read && posture === 'MARGIN_NEW_EXPOSURE',
    enableFutures: !read && ['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(posture),
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: !read && [
      'SPOT_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE', 'MARGIN_NEW_EXPOSURE',
    ].includes(posture),
    enablePortfolioMarginTrading: false,
  };
}

function tradingStatusValue() {
  return {
    data: {
      isLocked: false,
      plannedRecoverTime: null,
      triggerCondition: { GCR: 0, IFER: 0, UFR: 0 },
      updateTime: EVALUATED_AT_MS - 100,
    },
  };
}

function valueFor(kind, profileId, posture) {
  switch (kind) {
    case 'SPOT_PERMISSIONS':
    case 'USDM_PERMISSIONS':
    case 'MARGIN_PERMISSIONS':
      return permissionValue(profileId, posture);
    case 'SPOT_ACCOUNT':
      return {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        commissionRates: { ...RATE },
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        brokered: false,
        requireSelfTradePrevention: true,
        preventSor: false,
        updateTime: EVALUATED_AT_MS - 100,
        accountType: 'SPOT',
        balances: [],
        permissions: ['SPOT'],
        uid: '1',
      };
    case 'SPOT_OPEN_ORDERS':
    case 'SPOT_TRADES':
    case 'USDM_BALANCE':
    case 'USDM_POSITIONS':
    case 'USDM_OPEN_ORDERS':
    case 'USDM_TRADES':
    case 'MARGIN_OPEN_ORDERS':
    case 'MARGIN_TRADES':
    case 'MARGIN_INTEREST_RATE':
      return [];
    case 'SPOT_COMMISSIONS':
      return {
        symbol: 'BTCUSDT',
        standardCommission: { ...RATE },
        specialCommission: { maker: '0', taker: '0', buyer: '0', seller: '0' },
        taxCommission: { maker: '0', taker: '0', buyer: '0', seller: '0' },
        discount: {
          enabledForAccount: false,
          enabledForSymbol: false,
          discountAsset: 'BNB',
          discount: '0',
        },
      };
    case 'SPOT_ACCOUNT_STATUS':
    case 'USDM_ACCOUNT_STATUS':
    case 'MARGIN_ACCOUNT_STATUS':
      return { data: 'Normal' };
    case 'SPOT_TRADING_STATUS':
    case 'USDM_TRADING_STATUS':
    case 'MARGIN_TRADING_STATUS':
      return tradingStatusValue();
    case 'USDM_ACCOUNT':
      return {
        totalInitialMargin: '0',
        totalMaintMargin: '0',
        totalWalletBalance: '10',
        totalUnrealizedProfit: '0',
        totalMarginBalance: '10',
        totalPositionInitialMargin: '0',
        totalOpenOrderInitialMargin: '0',
        totalCrossWalletBalance: '10',
        totalCrossUnPnl: '0',
        availableBalance: '10',
        maxWithdrawAmount: '10',
        assets: [],
        positions: [],
      };
    case 'USDM_MULTI_ASSETS_MODE':
      return { multiAssetsMargin: false };
    case 'USDM_POSITION_MODE':
      return { dualSidePosition: false };
    case 'MARGIN_CROSS_ACCOUNT':
      return {
        created: true,
        borrowEnabled: false,
        marginLevel: '999',
        collateralMarginLevel: '999',
        totalAssetOfBtc: '0',
        totalLiabilityOfBtc: '0',
        totalNetAssetOfBtc: '0',
        TotalCollateralValueInUSDT: '0',
        totalOpenOrderLossInUSDT: '0',
        tradeEnabled: true,
        transferInEnabled: false,
        transferOutEnabled: false,
        accountType: 'MARGIN_1',
        userAssets: [],
      };
    case 'MARGIN_INTEREST':
      return { rows: [], total: 0 };
    case 'MARGIN_INVENTORY':
      return { assets: {}, updateTime: EVALUATED_AT_MS - 100 };
    case 'USDM_COMMISSIONS':
    case 'USDM_INCOME':
    case 'USDM_ADL':
    case 'USDM_ALGO_OPEN_ORDERS':
    case 'USDM_ACCOUNT_CONFIGURATION':
    case 'USDM_SYMBOL_CONFIGURATION':
    case 'MARGIN_MAX_BORROWABLE':
    case 'MARGIN_BORROW_REPAY_HISTORY':
      return null;
    default:
      throw new Error(`missing synthetic value for ${kind}`);
  }
}

function usdmPositionSideValue(kind, positionSide) {
  if (kind === 'USDM_ACCOUNT') {
    return {
      totalInitialMargin: '60',
      totalMaintMargin: '3',
      totalWalletBalance: '10',
      totalUnrealizedProfit: '0.1',
      totalMarginBalance: '10.1',
      totalPositionInitialMargin: '60',
      totalOpenOrderInitialMargin: '0',
      totalCrossWalletBalance: '10',
      totalCrossUnPnl: '0.1',
      availableBalance: '9',
      maxWithdrawAmount: '9',
      assets: [],
      positions: [{
        symbol: 'BTCUSDT',
        positionSide,
        positionAmt: '0.01',
        unrealizedProfit: '0.1',
        isolatedMargin: '0',
        notional: '600.1',
        isolatedWallet: '0',
        initialMargin: '60',
        maintMargin: '3',
        updateTime: EVALUATED_AT_MS - 100,
      }],
    };
  }
  if (kind === 'USDM_POSITIONS') {
    return [{
      symbol: 'BTCUSDT',
      positionSide,
      positionAmt: '0.01',
      entryPrice: '60000',
      breakEvenPrice: '60000',
      markPrice: '60010',
      unRealizedProfit: '0.1',
      liquidationPrice: '0',
      isolatedMargin: '0',
      notional: '600.1',
      marginAsset: 'USDT',
      isolatedWallet: '0',
      initialMargin: '60',
      maintMargin: '3',
      positionInitialMargin: '60',
      openOrderInitialMargin: '0',
      adl: 0,
      bidNotional: '0',
      askNotional: '0',
      updateTime: EVALUATED_AT_MS - 100,
    }];
  }
  if (kind === 'USDM_OPEN_ORDERS') {
    return [{
      avgPrice: '0',
      clientOrderId: 'projection-usdm-order-1',
      cumQuote: '0',
      executedQty: '0',
      orderId: 101,
      origQty: '0.01',
      origType: 'LIMIT',
      price: '59000',
      reduceOnly: false,
      side: 'BUY',
      positionSide,
      status: 'NEW',
      stopPrice: '0',
      closePosition: false,
      symbol: 'BTCUSDT',
      time: EVALUATED_AT_MS - 200,
      timeInForce: 'GTC',
      type: 'LIMIT',
      activatePrice: '0',
      priceRate: '0',
      updateTime: EVALUATED_AT_MS - 100,
      workingType: 'CONTRACT_PRICE',
      priceProtect: false,
      priceMatch: 'NONE',
      selfTradePreventionMode: 'NONE',
      goodTillDate: 0,
    }];
  }
  if (kind === 'USDM_TRADES') {
    return [{
      symbol: 'BTCUSDT',
      id: 201,
      orderId: 101,
      price: '60000',
      qty: '0.01',
      quoteQty: '600',
      commission: '0.01',
      commissionAsset: 'USDT',
      realizedPnl: '0',
      side: 'BUY',
      positionSide,
      buyer: true,
      maker: false,
      time: EVALUATED_AT_MS - 100,
    }];
  }
  throw new Error(`missing USD-M position-side fixture for ${kind}`);
}

function fact(kind, index, {
  profileId = READ_PROFILE_ID,
  posture = 'SPOT_NEW_EXPOSURE',
  sourceTimeMs = EVALUATED_AT_MS - 100,
  receivedAtMs = EVALUATED_AT_MS - 50,
  maxAgeMs = 1_000,
  evaluatedAtMs = EVALUATED_AT_MS,
  injectedValue,
  query = {},
} = {}) {
  const product = productFor(kind);
  const gapReason = GAP_REASONS[kind] ?? null;
  const contract = resolvePrivateFactContract(kind, MATRIX_SHA, CONTRACT_IDS[kind]).contract;
  return normalizePrivateFactEvidence({
    schema: FACT_SCHEMA,
    matrixSha256: MATRIX_SHA,
    factKind: kind,
    product,
    environment: 'PRODUCTION',
    realm: contract?.realm ?? (product === 'MARGIN'
      ? 'PRIVATE_MARGIN_ACCOUNT'
      : 'PRIVATE_ACCOUNT'),
    accountRealmId: ACCOUNT_REALM,
    profileId: gapReason === null ? profileId : null,
    contractId: CONTRACT_IDS[kind],
    ...queryMetadata(kind, gapReason !== null),
    ...query,
    queryCoverage: queryCoverage(kind, gapReason !== null, sourceTimeMs),
    sourceId: contract?.sourceIds[0] ?? 'L02-BINANCE-2026-07-12',
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: `private-receipt:${index.toString(16).padStart(24, '0')}`,
    readState: gapReason === null ? 'OK' : 'UNAVAILABLE',
    authority: gapReason === null ? 'SYNTHETIC_TEST' : 'UNAVAILABLE',
    completeness: gapReason === null ? 'COMPLETE' : 'UNAVAILABLE',
    sourceTimeMs: gapReason === null ? sourceTimeMs : null,
    receivedAtMs,
    maxAgeMs,
    value: injectedValue ?? valueFor(kind, profileId, posture),
  }, evaluatedAtMs);
}

function factsFor(
  products,
  posture = 'SPOT_NEW_EXPOSURE',
  evaluatedAtMs = EVALUATED_AT_MS,
) {
  const rows = [];
  let index = 1;
  for (const product of products) {
    for (const kind of REQUIRED[product]) {
      if (kind.endsWith('_PERMISSIONS')) {
        rows.push(fact(kind, index, {
          profileId: READ_PROFILE_ID,
          posture,
          evaluatedAtMs,
        }));
        index += 1;
        rows.push(fact(kind, index, {
          profileId: EXECUTION_PROFILE_ID,
          posture,
          evaluatedAtMs,
        }));
        index += 1;
      } else {
        rows.push(fact(kind, index, { posture, evaluatedAtMs }));
        index += 1;
      }
    }
  }
  return rows;
}

function permissionProfile(profileClass, posture, overrides = {}) {
  const read = profileClass === 'READ_KEY';
  const permissions = {
    ipRestrict: true,
    enableReading: read,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: !read && posture === 'MARGIN_NEW_EXPOSURE',
    enableFutures: !read && ['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(posture),
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: !read && [
      'SPOT_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE', 'MARGIN_NEW_EXPOSURE',
    ].includes(posture),
    enablePortfolioMarginTrading: false,
    ...(overrides.permissions ?? {}),
  };
  return {
    profileClass,
    profileId: overrides.profileId ?? (read ? READ_PROFILE_ID : EXECUTION_PROFILE_ID),
    accountRealmId: overrides.accountRealmId ?? ACCOUNT_REALM,
    accountFingerprintRef: overrides.accountFingerprintRef ?? 'account-fingerprint-reference-v1',
    environment: 'PRODUCTION',
    deployedEgressMatch: overrides.deployedEgressMatch ?? true,
    permissions,
    accountStatus: overrides.accountStatus ?? 'Normal',
    apiTradingLocked: overrides.apiTradingLocked ?? false,
    usdmDualSidePosition: overrides.usdmDualSidePosition ?? false,
    usdmMultiAssetsMargin: overrides.usdmMultiAssetsMargin ?? false,
    marginMode: overrides.marginMode ?? 'CROSS_CLASSIC',
  };
}

function permissionDecisions(posture, overrides = {}) {
  const accountFingerprintRef = overrides.accountFingerprintRef
    ?? 'account-fingerprint-reference-v1';
  return evaluatePrivatePermissions({
    matrixSha256: MATRIX_SHA,
    posture,
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef,
    readProfile: permissionProfile('READ_KEY', posture, {
      accountFingerprintRef,
      ...(overrides.read ?? {}),
    }),
    executionProfile: permissionProfile('EXECUTION_KEY', posture, {
      accountFingerprintRef,
      ...(overrides.execution ?? {}),
    }),
  });
}

function permissionDecision(profileClass, posture, overrides = {}) {
  const decisions = permissionDecisions(posture, {
    [profileClass === 'READ_KEY' ? 'read' : 'execution']: overrides,
  });
  return decisions.find((item) => item.profileClass === profileClass);
}

function reconciliation(overrides = {}) {
  return {
    owner: overrides.owner ?? 'FOUNDATION_RECONCILIATION',
    status: overrides.status ?? 'EXACT',
    resultRevision: overrides.resultRevision ?? RECONCILIATION_RESULT_REVISION,
    sourceCutRevision: overrides.sourceCutRevision ?? null,
    productCutRevisions: overrides.productCutRevisions ?? null,
    observedAtMs: overrides.observedAtMs ?? EVALUATED_AT_MS,
    executionAuthority: overrides.executionAuthority ?? 'NONE',
  };
}

function productCutRevisions(posture) {
  return {
    SPOT: ['SPOT_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(posture)
      ? SPOT_RECONCILIATION_REVISION : null,
    USD_M_PERPETUAL: ['USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE'].includes(posture)
      ? USDM_RECONCILIATION_REVISION : null,
    MARGIN: null,
  };
}

const HISTORY_FACT_KINDS = Object.freeze({
  SPOT_NEW_EXPOSURE: Object.freeze(['SPOT_TRADES']),
  USDM_NEW_EXPOSURE: Object.freeze(['USDM_TRADES']),
  SPOT_USDM_NEW_EXPOSURE: Object.freeze(['SPOT_TRADES', 'USDM_TRADES']),
  MARGIN_NEW_EXPOSURE: Object.freeze([
    'MARGIN_TRADES', 'MARGIN_INTEREST', 'MARGIN_INTEREST_RATE',
  ]),
  SUPERVISION_ONLY: Object.freeze([]),
});

function historyCoverageRequirements(posture, targetSymbol, facts, sourceCutRevision) {
  return HISTORY_FACT_KINDS[posture].flatMap((kind, index) => {
    const sourceFact = facts.find((factValue) => factValue.factKind === kind);
    if (sourceFact === undefined) return [];
    return [{
      owner: 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE',
      status: 'EXACT_REQUIREMENT',
      requirementRevision: `foundation-history-coverage-requirement:${(index + 1).toString(16).padStart(24, '0')}`,
      accountRealmId: ACCOUNT_REALM,
      posture,
      targetSymbol,
      factKind: kind,
      factEvidenceRevision: sourceFact.evidenceRevision,
      sourceCutRevision,
      startTimeMs: sourceFact.queryCoverage.startTimeMs,
      endTimeMs: sourceFact.queryCoverage.endTimeMs,
      executionAuthority: 'NONE',
    }];
  });
}

function applySpotLifecycle(state, observation) {
  const result = reduceSpotPrivateLifecycle(state, observation);
  assert.equal(result.accepted, true, JSON.stringify(result.issues));
  return result.state;
}

function currentSpotLifecycleState({
  accountRealmId = ACCOUNT_REALM,
  subscriptionId = 7,
  reconciliationRevision = null,
  reconnectPlannedAtMs = EVALUATED_AT_MS + 23 * 60 * 60 * 1_000,
  validUntilMs = EXPECTED_VALID_UNTIL_MS,
} = {}) {
  const generation = 1;
  const contentRevision = SPOT_EVENT_CONTENT_REVISION;
  const eventRevision = createSpotRealmBoundRevision(
    'spot_event',
    accountRealmId,
    {
      generation,
      eventKind: 'ACCOUNT',
      contentRevision,
      exchangeEventTimeMs: EVALUATED_AT_MS - 200,
      receiptTimeMs: EVALUATED_AT_MS - 150,
    },
  );
  const resolvedReconciliationRevision = reconciliationRevision
    ?? createSpotRealmBoundRevision('spot_rest', accountRealmId, {
      generation,
      reconciledAtMs: EVALUATED_AT_MS,
      validUntilMs,
      throughEventRevision: eventRevision,
      throughExchangeEventTimeMs: EVALUATED_AT_MS - 200,
    });
  let state = createInitialSpotPrivateLifecycleState(accountRealmId);
  state = applySpotLifecycle(state, {
    kind: 'CONNECTION_OPENED',
    accountRealmId,
    generation,
    observedAtMs: EVALUATED_AT_MS - 300,
    connectedAtMs: EVALUATED_AT_MS - 300,
    reconnectPlannedAtMs,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
  });
  state = applySpotLifecycle(state, {
    kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED',
    accountRealmId,
    generation,
    observedAtMs: EVALUATED_AT_MS - 250,
    subscriptionId,
    sessionActiveSubscriptionCount: 1,
    sessionLifetimeSubscriptionCount: 1,
  });
  state = applySpotLifecycle(state, {
    kind: 'PRIVATE_EVENT_OBSERVED',
    accountRealmId,
    generation,
    eventKind: 'ACCOUNT',
    eventRevision,
    contentRevision,
    exchangeEventTimeMs: EVALUATED_AT_MS - 200,
    receiptTimeMs: EVALUATED_AT_MS - 150,
  });
  return applySpotLifecycle(state, {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED',
    accountRealmId,
    generation,
    reconciliationRevision: resolvedReconciliationRevision,
    reconciledAtMs: EVALUATED_AT_MS,
    validUntilMs,
    throughEventRevision: eventRevision,
    throughExchangeEventTimeMs: EVALUATED_AT_MS - 200,
  });
}

function spotLifecycleWitness({
  witnessEvaluatedAtMs = EVALUATED_AT_MS,
  ...options
} = {}) {
  return createPrivateLifecycleWitness({
    state: currentSpotLifecycleState(options),
    evaluatedAtMs: witnessEvaluatedAtMs,
  });
}

function forgedSpotLifecycleWitness() {
  const witness = structuredClone(spotLifecycleWitness());
  witness.lifecycleRevision = 'l05lifecycle_forged';
  return witness;
}

function projectionInput({
  posture = 'SPOT_NEW_EXPOSURE',
  targetSymbol = 'BTCUSDT',
  facts,
  permissions,
  historyCoverageRequirements: suppliedHistoryCoverageRequirements,
  reconciliationObservation = reconciliation(),
  evaluatedAtMs = EVALUATED_AT_MS,
} = {}) {
  const permissionRows = permissions ?? [
    permissionDecision('READ_KEY', posture),
    permissionDecision('EXECUTION_KEY', posture),
  ];
  const sourceFacts = structuredClone(facts ?? factsFor(['SPOT'], posture));
  const orderedPermissions = structuredClone(permissionRows);
  const cutInput = {
    matrixSha256: MATRIX_SHA,
    posture,
    accountRealmId: ACCOUNT_REALM,
    targetSymbol,
    evaluatedAtMs,
    facts: sourceFacts,
    permissions: orderedPermissions,
  };
  const boundReconciliation = reconciliationObservation === null
    ? null
    : {
        ...reconciliationObservation,
        sourceCutRevision: reconciliationObservation.sourceCutRevision
          ?? derivePrivateTruthSourceCutRevision(cutInput),
        productCutRevisions: reconciliationObservation.productCutRevisions
          ?? productCutRevisions(posture),
      };
  const sourceCutRevision = derivePrivateTruthSourceCutRevision(cutInput);
  const boundHistoryCoverageRequirements = suppliedHistoryCoverageRequirements
    ?? historyCoverageRequirements(posture, targetSymbol, sourceFacts, sourceCutRevision);
  return {
    ...cutInput,
    historyCoverageRequirements: boundHistoryCoverageRequirements,
    reconciliationObservation: boundReconciliation,
  };
}

function project(options) {
  return projectPrivateTruth(projectionInput(options));
}

function assertNoAuthority(value) {
  assert.equal(value.sendEligible, false);
  assert.equal(value.accountReadAuthority, 'NONE');
  assert.equal(value.mutationAuthority, 'NONE');
  assert.equal(value.reconciliationAuthority, 'NONE');
  assert.equal(value.capitalAuthority, 'NONE');
  assert.equal(value.riskAuthority, 'NONE');
  assert.equal(value.externalActionAuthorization, 'NONE');
  assert.equal(value.actionAuthority, 'NONE_RECORD_ONLY');
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function sortedPermissionRevisions(projectionValue) {
  return projectionValue.permissions.map((item) => item.revision).sort();
}

function waitingFixture({ projectionValue = project(), binding = {}, input = {} } = {}) {
  const permissionRevisions = sortedPermissionRevisions(projectionValue);
  const lifecycleWitnesses = [spotLifecycleWitness()];
  const canonicalPrior = createWaitingPrivateTruthBinding({
    currentSymbol: 'BTCUSDT',
    currentInstrumentRevision: INSTRUMENT_REVISION,
    currentInstrumentEvidenceRevision: INSTRUMENT_EVIDENCE_REVISION,
    currentInstrumentSnapshotRevision: INSTRUMENT_SNAPSHOT_REVISION,
    projection: project(),
    lifecycleWitnesses,
  });
  const prior = { ...canonicalPrior, ...binding };
  return {
    binding: prior,
    currentSymbol: 'BTCUSDT',
    currentInstrumentRevision: INSTRUMENT_REVISION,
    currentInstrumentEvidenceRevision: INSTRUMENT_EVIDENCE_REVISION,
    currentInstrumentSnapshotRevision: INSTRUMENT_SNAPSHOT_REVISION,
    projection: projectionValue,
    permissionRevisions: [...permissionRevisions],
    lifecycleWitnesses: structuredClone(lifecycleWitnesses),
    reconciliationCutRevision: projectionValue.reconciliationObservation?.sourceCutRevision ?? null,
    evaluatedAtMs: EVALUATED_AT_MS,
    ...input,
  };
}

function assertWaiting(result, state, reasonCodes) {
  assert.equal(result.state, state);
  assert.deepEqual(result.reasonCodes, [...reasonCodes].sort());
  assert.match(result.bindingRevision, /^l05wait_[0-9a-f]{64}$/);
  assert.equal(result.persistenceProven, false);
  assertNoAuthority(result);
  assertDeeplyFrozen(result);
}

test('Spot completeness is action-scoped and never promotes unknown sibling products', () => {
  const result = project();
  assert.equal(result.schema, PROJECTION_SCHEMA);
  assert.equal(result.completeness, 'COMPLETE');
  assert.equal(result.entryEvidenceComplete, true);
  assert.equal(result.spot.completeness, 'COMPLETE');
  assert.equal(result.futures.completeness, 'UNKNOWN');
  assert.equal(result.margin.completeness, 'UNKNOWN');
  assert.deepEqual(result.futures.factKinds, []);
  assert.deepEqual(result.margin.factKinds, []);
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(result.permissions.map((item) => item.profileClass), ['READ_KEY', 'EXECUTION_KEY']);
  assert.equal(result.sourceFacts.length, 8);
  assert.equal(result.historyCoverageRequirements.length, 1);
  assert.equal(result.historyCoverageRequirements[0].factKind, 'SPOT_TRADES');
  assert.deepEqual(
    { ...result.reconciliationObservation },
    reconciliation({
      sourceCutRevision: result.reconciliationObservation.sourceCutRevision,
      productCutRevisions: productCutRevisions('SPOT_NEW_EXPOSURE'),
    }),
  );
  assert.equal(result.validUntilMs, EXPECTED_VALID_UNTIL_MS);
  assert.deepEqual(validatePrivateTruthProjection(result), result);
  assertNoAuthority(result);
  assertDeeplyFrozen(result);
});

test('caller-chosen history windows cannot complete a product without exact Foundation owner requirements', () => {
  const missing = project({ historyCoverageRequirements: [] });
  assert.equal(missing.entryEvidenceComplete, false);
  assert.equal(missing.spot.completeness, 'PARTIAL');
  assert.ok(missing.reasonCodes.includes(
    'FOUNDATION_HISTORY_COVERAGE_REQUIREMENT_MISSING_SPOT_TRADES',
  ));
  assertNoAuthority(missing);

  const exactInput = projectionInput();
  const duplicate = structuredClone(exactInput.historyCoverageRequirements[0]);
  const duplicated = projectPrivateTruth({
    ...exactInput,
    historyCoverageRequirements: [
      exactInput.historyCoverageRequirements[0],
      duplicate,
    ],
  });
  assert.equal(duplicated.entryEvidenceComplete, false);
  assert.ok(duplicated.reasonCodes.includes(
    'FOUNDATION_HISTORY_COVERAGE_DUPLICATE_REQUIREMENT_REVISION',
  ));
  assert.ok(duplicated.reasonCodes.includes(
    'FOUNDATION_HISTORY_COVERAGE_REQUIREMENT_DUPLICATE_SPOT_TRADES',
  ));

  const mismatchedWindow = structuredClone(exactInput.historyCoverageRequirements[0]);
  mismatchedWindow.startTimeMs += 1;
  const mismatched = projectPrivateTruth({
    ...exactInput,
    historyCoverageRequirements: [mismatchedWindow],
  });
  assert.equal(mismatched.entryEvidenceComplete, false);
  assert.ok(mismatched.reasonCodes.includes(
    'FOUNDATION_HISTORY_COVERAGE_WINDOW_MISMATCH_SPOT_TRADES',
  ));
});

test('new-exposure completeness requires all-symbol open-order evidence for every product', async (t) => {
  const vectors = [
    {
      name: 'Spot',
      product: 'SPOT',
      posture: 'SPOT_NEW_EXPOSURE',
      kind: 'SPOT_OPEN_ORDERS',
      reason: 'FACT_OPEN_ORDERS_NOT_ALL_SYMBOLS_SPOT_OPEN_ORDERS',
    },
    {
      name: 'USD-M',
      product: 'USD_M_PERPETUAL',
      posture: 'USDM_NEW_EXPOSURE',
      kind: 'USDM_OPEN_ORDERS',
      reason: 'FACT_OPEN_ORDERS_NOT_ALL_SYMBOLS_USDM_OPEN_ORDERS',
    },
    {
      name: 'Margin',
      product: 'MARGIN',
      posture: 'MARGIN_NEW_EXPOSURE',
      kind: 'MARGIN_OPEN_ORDERS',
      reason: 'FACT_OPEN_ORDERS_NOT_ALL_SYMBOLS_MARGIN_OPEN_ORDERS',
    },
  ];
  for (let index = 0; index < vectors.length; index += 1) {
    const vector = vectors[index];
    await t.test(vector.name, () => {
      const allSymbolFacts = factsFor([vector.product], vector.posture);
      const permissionRows = [
        permissionDecision('READ_KEY', vector.posture),
        permissionDecision('EXECUTION_KEY', vector.posture),
      ];
      const allSymbols = project({
        posture: vector.posture,
        facts: allSymbolFacts,
        permissions: permissionRows,
      });
      const allSymbolsProduct = vector.product === 'SPOT'
        ? allSymbols.spot
        : vector.product === 'USD_M_PERPETUAL'
          ? allSymbols.futures
          : allSymbols.margin;
      assert.equal(allSymbolsProduct.reasonCodes.includes(vector.reason), false);

      const targetedOpenOrders = fact(vector.kind, 900 + index, {
        posture: vector.posture,
        query: {
          queryScope: 'SYMBOL',
          querySymbol: 'BTCUSDT',
          ...(vector.product === 'MARGIN' ? { marginMode: 'CROSS' } : {}),
        },
      });
      assert.equal(targetedOpenOrders.usableAsPrivateEvidence, true);
      const targetedFacts = allSymbolFacts.map((sourceFact) => (
        sourceFact.factKind === vector.kind ? targetedOpenOrders : sourceFact
      ));
      const targeted = project({
        posture: vector.posture,
        facts: targetedFacts,
        permissions: permissionRows,
      });
      const targetedProduct = vector.product === 'SPOT'
        ? targeted.spot
        : vector.product === 'USD_M_PERPETUAL'
          ? targeted.futures
          : targeted.margin;
      assert.equal(targeted.entryEvidenceComplete, false);
      assert.equal(targetedProduct.completeness, 'PARTIAL');
      assert.ok(targetedProduct.reasonCodes.includes(vector.reason));
      assert.ok(targeted.reasonCodes.includes(vector.reason));
      assertNoAuthority(targeted);
    });
  }
});

test('USD-M position mode binds permission posture and every position-side-bearing fact', async (t) => {
  const posture = 'USDM_NEW_EXPOSURE';
  const oneWayPermissions = [
    permissionDecision('READ_KEY', posture),
    permissionDecision('EXECUTION_KEY', posture),
  ];
  const vectors = ['USDM_ACCOUNT', 'USDM_POSITIONS', 'USDM_OPEN_ORDERS', 'USDM_TRADES'];
  for (let index = 0; index < vectors.length; index += 1) {
    const kind = vectors[index];
    await t.test(`one-way ${kind}`, () => {
      const replacement = fact(kind, 1_100 + index, {
        posture,
        injectedValue: usdmPositionSideValue(kind, 'LONG'),
      });
      const sourceFacts = factsFor(['USD_M_PERPETUAL'], posture).map((sourceFact) => (
        sourceFact.factKind === kind ? replacement : sourceFact
      ));
      const result = project({
        posture,
        facts: sourceFacts,
        permissions: oneWayPermissions,
      });
      const reason = `USDM_ONE_WAY_POSITION_SIDE_MISMATCH_${kind}`;
      assert.ok(result.futures.reasonCodes.includes(reason));
      assert.ok(result.reasonCodes.includes(reason));
      assert.equal(
        result.futures.reasonCodes.includes('USDM_POSITION_MODE_FACT_PERMISSION_MISMATCH'),
        false,
      );
      assert.equal(result.entryEvidenceComplete, false);
      assertNoAuthority(result);
    });
  }

  const hedgePermissions = permissionDecisions(posture, {
    read: { usdmDualSidePosition: true },
    execution: { usdmDualSidePosition: true },
  });
  const hedgeMode = fact('USDM_POSITION_MODE', 1_120, {
    posture,
    injectedValue: { dualSidePosition: true },
  });
  const bothPosition = fact('USDM_POSITIONS', 1_121, {
    posture,
    injectedValue: usdmPositionSideValue('USDM_POSITIONS', 'BOTH'),
  });
  const hedgeFacts = factsFor(['USD_M_PERPETUAL'], posture).map((sourceFact) => {
    if (sourceFact.factKind === 'USDM_POSITION_MODE') return hedgeMode;
    if (sourceFact.factKind === 'USDM_POSITIONS') return bothPosition;
    return sourceFact;
  });
  const hedge = project({
    posture,
    facts: hedgeFacts,
    permissions: hedgePermissions,
  });
  assert.ok(hedge.futures.reasonCodes.includes(
    'USDM_HEDGE_POSITION_SIDE_MISMATCH_USDM_POSITIONS',
  ));
  assert.equal(
    hedge.futures.reasonCodes.includes('USDM_POSITION_MODE_FACT_PERMISSION_MISMATCH'),
    false,
  );
  assert.equal(hedge.entryEvidenceComplete, false);
  assertNoAuthority(hedge);

  const permissionMismatch = project({
    posture,
    facts: factsFor(['USD_M_PERPETUAL'], posture),
    permissions: hedgePermissions,
  });
  assert.ok(permissionMismatch.futures.reasonCodes.includes(
    'USDM_POSITION_MODE_FACT_PERMISSION_MISMATCH',
  ));
  assert.equal(permissionMismatch.entryEvidenceComplete, false);
  assertNoAuthority(permissionMismatch);
});

test('projection retains a sorted reproducible source cut and rejects forged stale usability', () => {
  const input = projectionInput();
  const result = projectPrivateTruth({
    ...input,
    facts: [...input.facts].reverse(),
  });
  assert.deepEqual(
    result.sourceFacts,
    [...result.sourceFacts].sort((left, right) => {
      const a = canonicalJson(left);
      const b = canonicalJson(right);
      return a < b ? -1 : a > b ? 1 : 0;
    }),
  );
  assert.deepEqual(validatePrivateTruthProjection(structuredClone(result)), result);

  const stale = fact('SPOT_ACCOUNT', 500, {
    sourceTimeMs: EVALUATED_AT_MS - 2_000,
    maxAgeMs: 1_000,
  });
  assert.equal(stale.usableAsPrivateEvidence, false);
  const forgedStale = structuredClone(stale);
  forgedStale.usableAsPrivateEvidence = true;
  const forgedFacts = factsFor(['SPOT']).map((item) => (
    item.factKind === 'SPOT_ACCOUNT' ? forgedStale : item
  ));
  assert.throws(
    () => project({ facts: forgedFacts }),
    /does not reproduce from its injected-value witness/,
  );
});

test('fresh sibling evidence cannot fill a missing required Spot fact', () => {
  const siblingFacts = factsFor(['USD_M_PERPETUAL']);
  const result = project({ facts: siblingFacts });
  assert.equal(result.completeness, 'PARTIAL');
  assert.equal(result.entryEvidenceComplete, false);
  assert.equal(result.spot.completeness, 'UNKNOWN');
  assert.ok(result.spot.reasonCodes.includes('FACT_MISSING_SPOT_ACCOUNT'));
  assert.equal(result.futures.completeness, 'PARTIAL');
  assertNoAuthority(result);
});

test('accepted L02 USD-M and Margin gaps remain explicit and block their entry postures', () => {
  const spotUsdmFacts = factsFor(
    ['SPOT', 'USD_M_PERPETUAL', 'MARGIN'],
    'SPOT_USDM_NEW_EXPOSURE',
  );
  const usdm = project({
    posture: 'SPOT_USDM_NEW_EXPOSURE',
    facts: spotUsdmFacts,
    permissions: [
      permissionDecision('READ_KEY', 'SPOT_USDM_NEW_EXPOSURE'),
      permissionDecision('EXECUTION_KEY', 'SPOT_USDM_NEW_EXPOSURE'),
    ],
  });
  assert.equal(usdm.spot.completeness, 'COMPLETE');
  assert.equal(usdm.futures.completeness, 'PARTIAL');
  assert.equal(usdm.entryEvidenceComplete, false);
  assert.deepEqual(usdm.reconciliationObservation.productCutRevisions, {
    SPOT: SPOT_RECONCILIATION_REVISION,
    USD_M_PERPETUAL: USDM_RECONCILIATION_REVISION,
    MARGIN: null,
  });
  assert.notEqual(
    usdm.reconciliationObservation.productCutRevisions.SPOT,
    usdm.reconciliationObservation.productCutRevisions.USD_M_PERPETUAL,
  );
  for (const [kind, reason] of Object.entries(GAP_REASONS).filter(([kind]) => kind.startsWith('USDM_'))) {
    assert.ok(usdm.futures.reasonCodes.includes(`FACT_UNUSABLE_${kind}`));
    assert.ok(usdm.futures.reasonCodes.includes(reason));
    assert.ok(usdm.reasonCodes.includes(reason));
  }

  const margin = project({
    posture: 'MARGIN_NEW_EXPOSURE',
    facts: factsFor(['SPOT', 'USD_M_PERPETUAL', 'MARGIN'], 'MARGIN_NEW_EXPOSURE'),
    permissions: [
      permissionDecision('READ_KEY', 'MARGIN_NEW_EXPOSURE'),
      permissionDecision('EXECUTION_KEY', 'MARGIN_NEW_EXPOSURE'),
    ],
  });
  assert.equal(margin.margin.completeness, 'PARTIAL');
  assert.equal(margin.entryEvidenceComplete, false);
  assert.ok(margin.margin.reasonCodes.includes('FACT_UNUSABLE_MARGIN_MAX_BORROWABLE'));
  assert.ok(margin.reasonCodes.includes(GAP_REASONS.MARGIN_MAX_BORROWABLE));
  assertNoAuthority(usdm);
  assertNoAuthority(margin);
});

test('Foundation reconciliation must be exact and observed at the identical projection cut', async (t) => {
  const exact = project();
  assert.equal(exact.entryEvidenceComplete, true);

  for (const [name, observation, reason] of [
    ['missing', null, 'FOUNDATION_RECONCILIATION_REQUIRED'],
    ['one millisecond before', reconciliation({ observedAtMs: EVALUATED_AT_MS - 1 }), 'FOUNDATION_RECONCILIATION_CUT_NOT_CURRENT'],
    ['one millisecond after', reconciliation({ observedAtMs: EVALUATED_AT_MS + 1 }), 'FOUNDATION_RECONCILIATION_CUT_NOT_CURRENT'],
    ['future skew beyond bound', reconciliation({ observedAtMs: EVALUATED_AT_MS + 2_001 }), 'FOUNDATION_RECONCILIATION_CLOCK_SKEWED'],
  ]) {
    await t.test(name, () => {
      const result = project({ reconciliationObservation: observation });
      assert.equal(result.entryEvidenceComplete, false);
      assert.equal(result.completeness, 'PARTIAL');
      assert.ok(result.reasonCodes.includes(reason));
      assertNoAuthority(result);
    });
  }

  for (const hostile of [
    reconciliation({ owner: 'CALLER_RECONCILIATION' }),
    reconciliation({ status: 'PARTIAL' }),
    reconciliation({ executionAuthority: 'LIVE' }),
  ]) {
    assert.throws(
      () => project({ reconciliationObservation: hostile }),
      /Foundation reconciliation observation authority mismatch/,
    );
  }
});

test('projection requires exactly two distinct permission decisions and exact permission fact profiles', () => {
  const oneDecision = [permissionDecision('READ_KEY', 'SPOT_NEW_EXPOSURE')];
  assert.throws(() => project({ permissions: oneDecision }), /exactly two permission profile decisions/);

  const duplicateClass = [
    permissionDecision('READ_KEY', 'SPOT_NEW_EXPOSURE'),
    permissionDecision('READ_KEY', 'SPOT_NEW_EXPOSURE', {
      profileId: 'profile-read-second',
      revision: 'permission-read-second',
    }),
  ];
  assert.throws(() => project({ permissions: duplicateClass }), /distinct read and execution profiles/);

  const duplicateIdentity = [
    permissionDecision('READ_KEY', 'SPOT_NEW_EXPOSURE'),
    permissionDecision('EXECUTION_KEY', 'SPOT_NEW_EXPOSURE', {
      profileId: READ_PROFILE_ID,
      revision: READ_PERMISSION_REVISION,
    }),
  ];
  assert.throws(() => project({ permissions: duplicateIdentity }), /distinct read and execution profiles/);

  const missingExecutionFact = factsFor(['SPOT']).filter((item) => (
    item.factKind !== 'SPOT_PERMISSIONS' || item.profileId === READ_PROFILE_ID
  ));
  const missing = project({ facts: missingExecutionFact });
  assert.equal(missing.spot.completeness, 'PARTIAL');
  assert.ok(missing.spot.reasonCodes.includes('FACT_PERMISSION_PROFILE_SET_MISMATCH_SPOT_PERMISSIONS'));

  const mismatchedFacts = factsFor(['SPOT']).map((item, index) => (
    item.factKind === 'SPOT_PERMISSIONS' && item.profileId === EXECUTION_PROFILE_ID
      ? fact('SPOT_PERMISSIONS', 100 + index, { profileId: 'profile-foreign-v1' })
      : item
  ));
  const mismatched = project({ facts: mismatchedFacts });
  assert.equal(mismatched.spot.completeness, 'PARTIAL');
  assert.ok(mismatched.spot.reasonCodes.includes('FACT_PERMISSION_PROFILE_SET_MISMATCH_SPOT_PERMISSIONS'));

  const blockedPermissions = permissionDecisions('SPOT_NEW_EXPOSURE', {
    read: { deployedEgressMatch: false },
  });
  const blocked = project({ permissions: blockedPermissions });
  assert.equal(blocked.entryEvidenceComplete, false);
  assert.ok(blocked.reasonCodes.includes('DEPLOYED_EGRESS_MISMATCH'));
  assertNoAuthority(blocked);
});

test('permission facts bind every normalized boolean to the matching permission decision', () => {
  const contradictoryExecutionFact = fact('SPOT_PERMISSIONS', 700, {
    profileId: EXECUTION_PROFILE_ID,
    posture: 'SPOT_NEW_EXPOSURE',
    injectedValue: {
      ...permissionValue(EXECUTION_PROFILE_ID, 'SPOT_NEW_EXPOSURE'),
      enableSpotAndMarginTrading: false,
    },
  });
  const facts = factsFor(['SPOT']).map((item) => (
    item.factKind === 'SPOT_PERMISSIONS' && item.profileId === EXECUTION_PROFILE_ID
      ? contradictoryExecutionFact
      : item
  ));
  const result = project({ facts });
  assert.equal(result.entryEvidenceComplete, false);
  assert.ok(result.spot.reasonCodes.includes(
    'FACT_PERMISSION_PAYLOAD_MISMATCH_SPOT_PERMISSIONS',
  ));
  assertNoAuthority(result);
});

test('USD-M algo/configuration and Margin borrow-repay gaps stay cross-contract closed', () => {
  for (const [kind, foreignContract] of [
    ['USDM_ALGO_OPEN_ORDERS', 'USDM_OPEN_ORDERS_QUERY'],
    ['USDM_ACCOUNT_CONFIGURATION', 'USDM_ACCOUNT_V3'],
    ['USDM_SYMBOL_CONFIGURATION', 'USDM_ACCOUNT_V3'],
    ['MARGIN_BORROW_REPAY_HISTORY', 'MARGIN_INTEREST_HISTORY_QUERY'],
  ]) {
    assert.throws(
      () => resolvePrivateFactContract(kind, MATRIX_SHA, foreignContract),
      /no accepted L02 contract/,
    );
  }
  const algoGap = fact('USDM_ALGO_OPEN_ORDERS', 708, {
    posture: 'USDM_NEW_EXPOSURE',
  });
  const accountConfigGap = fact('USDM_ACCOUNT_CONFIGURATION', 709, {
    posture: 'USDM_NEW_EXPOSURE',
  });
  const usdmGap = fact('USDM_SYMBOL_CONFIGURATION', 710, {
    posture: 'USDM_NEW_EXPOSURE',
  });
  const marginGap = fact('MARGIN_BORROW_REPAY_HISTORY', 711, {
    posture: 'MARGIN_NEW_EXPOSURE',
  });
  assert.equal(algoGap.value, null);
  assert.equal(accountConfigGap.value, null);
  assert.equal(usdmGap.value, null);
  assert.equal(marginGap.value, null);
  assert.deepEqual(algoGap.contentBlockingCodes, [GAP_REASONS.USDM_ALGO_OPEN_ORDERS]);
  assert.deepEqual(accountConfigGap.contentBlockingCodes, [GAP_REASONS.USDM_ACCOUNT_CONFIGURATION]);
  assert.deepEqual(usdmGap.contentBlockingCodes, [GAP_REASONS.USDM_SYMBOL_CONFIGURATION]);
  assert.deepEqual(marginGap.contentBlockingCodes, [GAP_REASONS.MARGIN_BORROW_REPAY_HISTORY]);
});

test('projection revisions are insertion-order deterministic while evidence and input stay detached', () => {
  const input = projectionInput();
  const first = projectPrivateTruth(input);
  const reordered = projectPrivateTruth({
    ...projectionInput(),
    facts: [...projectionInput().facts].reverse(),
    permissions: [...projectionInput().permissions].reverse(),
  });
  assert.equal(reordered.semanticRevision, first.semanticRevision);
  assert.equal(reordered.evidenceRevision, first.evidenceRevision);
  assert.equal(reordered.projectionRevision, first.projectionRevision);
  assert.deepEqual(reordered, first);

  input.facts[0].contentRevision = 'caller-mutated-content';
  input.permissions[0].revision = 'caller-mutated-permission';
  assert.notEqual(first.spot.contentRevisions[0], 'caller-mutated-content');
  assert.notEqual(first.permissions[0].revision, 'caller-mutated-permission');
  assertDeeplyFrozen(first);
});

test('full projection validation rejects forged cuts, products, permissions and validity', () => {
  const authentic = project();
  const candidates = [];

  const posture = structuredClone(authentic);
  posture.posture = 'USDM_NEW_EXPOSURE';
  candidates.push(posture);

  const product = structuredClone(authentic);
  product.spot.completeness = 'UNKNOWN';
  candidates.push(product);

  const permissionStub = structuredClone(authentic);
  permissionStub.permissions[0] = { revision: authentic.permissions[0].revision };
  candidates.push(permissionStub);

  const futureValidity = structuredClone(authentic);
  futureValidity.validUntilMs += 86_400_000;
  candidates.push(futureValidity);

  const reconciliationCut = structuredClone(authentic);
  reconciliationCut.reconciliationObservation.sourceCutRevision = 'forged-foundation-cut';
  candidates.push(reconciliationCut);

  const lifecycleCut = structuredClone(authentic);
  lifecycleCut.reconciliationObservation.productCutRevisions.SPOT =
    'spot_rest_00000000000000000000000000000002';
  candidates.push(lifecycleCut);

  const siblingLifecycleCut = structuredClone(authentic);
  siblingLifecycleCut.reconciliationObservation.productCutRevisions.USD_M_PERPETUAL =
    USDM_RECONCILIATION_REVISION;
  candidates.push(siblingLifecycleCut);

  for (const candidate of candidates) {
    assert.throws(() => validatePrivateTruthProjection(candidate));
    assertWaiting(
      decideWaitingPrivateTruth(waitingFixture({ projectionValue: candidate })),
      'BLOCKED',
      ['WAITING_PRIVATE_INPUT_REJECTED'],
    );
  }
});

test('projection rejects accessors, proxies, inherited and unknown fields without invoking hostile code', () => {
  let getterCalls = 0;
  const accessor = projectionInput();
  Object.defineProperty(accessor, 'facts', {
    enumerable: true,
    get() { getterCalls += 1; return []; },
  });
  assert.throws(() => projectPrivateTruth(accessor), /private evidence rejected/);
  assert.equal(getterCalls, 0);

  const trapCalls = [];
  const activeProxy = new Proxy({}, {
    get() { trapCalls.push('get'); throw new Error('HOSTILE_GET'); },
    getOwnPropertyDescriptor() { trapCalls.push('descriptor'); throw new Error('HOSTILE_DESCRIPTOR'); },
    getPrototypeOf() { trapCalls.push('prototype'); throw new Error('HOSTILE_PROTOTYPE'); },
    ownKeys() { trapCalls.push('keys'); throw new Error('HOSTILE_KEYS'); },
  });
  assert.throws(() => projectPrivateTruth(activeProxy), /private evidence rejected/);
  assert.deepEqual(trapCalls, []);

  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.throws(() => projectPrivateTruth(revoked), /private evidence rejected/);

  const inherited = Object.create({ matrixSha256: MATRIX_SHA });
  Object.assign(inherited, projectionInput());
  delete inherited.matrixSha256;
  assert.throws(() => projectPrivateTruth(inherited), /plain objects are required/);

  assert.throws(
    () => projectPrivateTruth({ ...projectionInput(), unexpected: true }),
    /must use exact fields/,
  );
});

test('unchanged L04 instrument, symbol and private evidence binding is current but never sendable', () => {
  const fixture = waitingFixture();
  const result = decideWaitingPrivateTruth(fixture);
  assertWaiting(result, 'CURRENT_NON_SENDABLE', []);

  const exactExpiry = decideWaitingPrivateTruth({
    ...fixture,
    evaluatedAtMs: fixture.projection.validUntilMs,
  });
  assertWaiting(exactExpiry, 'CURRENT_NON_SENDABLE', []);
  assert.equal(result.bindingRevision, exactExpiry.bindingRevision);
});

test('waiting decisions never look ahead of binding, projection or lifecycle cuts', () => {
  const baseline = waitingFixture();

  const priorOneMillisecondAhead = {
    ...baseline.binding,
    evaluatedAtMs: EVALUATED_AT_MS + 1,
  };
  assertWaiting(decideWaitingPrivateTruth({
    ...baseline,
    binding: priorOneMillisecondAhead,
  }), 'BLOCKED', ['PRIVATE_WAITING_DECISION_PRECEDES_BINDING']);
  // At the prior cut, ordinary revision comparison resumes rather than being
  // hidden by the causal guard.
  assertWaiting(decideWaitingPrivateTruth({
    ...baseline,
    binding: priorOneMillisecondAhead,
    evaluatedAtMs: EVALUATED_AT_MS + 1,
  }), 'REVALIDATION_REQUIRED', ['PRIVATE_PROJECTION_EVALUATION_CUT_CHANGED']);

  const projectionOneMillisecondAhead = project({
    evaluatedAtMs: EVALUATED_AT_MS + 1,
    facts: factsFor(['SPOT'], 'SPOT_NEW_EXPOSURE', EVALUATED_AT_MS + 1),
    reconciliationObservation: reconciliation({
      observedAtMs: EVALUATED_AT_MS + 1,
    }),
  });
  const projectionWitnesses = [spotLifecycleWitness()];
  const canonicalProjectionBinding = createWaitingPrivateTruthBinding({
    currentSymbol: baseline.currentSymbol,
    currentInstrumentRevision: baseline.currentInstrumentRevision,
    currentInstrumentEvidenceRevision: baseline.currentInstrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: baseline.currentInstrumentSnapshotRevision,
    projection: projectionOneMillisecondAhead,
    lifecycleWitnesses: projectionWitnesses,
  });
  const projectionFixture = {
    ...waitingFixture({ projectionValue: projectionOneMillisecondAhead }),
    binding: {
      ...canonicalProjectionBinding,
      evaluatedAtMs: EVALUATED_AT_MS,
    },
    lifecycleWitnesses: projectionWitnesses,
  };
  assertWaiting(
    decideWaitingPrivateTruth(projectionFixture),
    'BLOCKED',
    ['PRIVATE_WAITING_DECISION_PRECEDES_PROJECTION'],
  );
  assertWaiting(decideWaitingPrivateTruth({
    ...projectionFixture,
    evaluatedAtMs: EVALUATED_AT_MS + 1,
  }), 'REVALIDATION_REQUIRED', ['PRIVATE_PROJECTION_EVALUATION_CUT_CHANGED']);

  // The witness observation is no later than its evaluation by construction;
  // binding the later evaluation proves the decision guard covers both cuts.
  const lifecycleOneMillisecondAhead = spotLifecycleWitness({
    witnessEvaluatedAtMs: EVALUATED_AT_MS + 1,
  });
  assert.throws(() => createWaitingPrivateTruthBinding({
    currentSymbol: baseline.currentSymbol,
    currentInstrumentRevision: baseline.currentInstrumentRevision,
    currentInstrumentEvidenceRevision: baseline.currentInstrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: baseline.currentInstrumentSnapshotRevision,
    projection: baseline.projection,
    lifecycleWitnesses: [lifecycleOneMillisecondAhead],
  }), /not current at the projection cut/);

  // A manually shaped prior cannot use the constructor rejection to conceal
  // the decision's own exact availability boundary.
  const manuallyBoundLifecycleAhead = {
    ...baseline.binding,
    lifecycleRevisions: [lifecycleOneMillisecondAhead.lifecycleRevision],
  };
  assertWaiting(
    decideWaitingPrivateTruth({
      ...baseline,
      binding: manuallyBoundLifecycleAhead,
      lifecycleWitnesses: [lifecycleOneMillisecondAhead],
    }),
    'BLOCKED',
    ['PRIVATE_WAITING_DECISION_PRECEDES_LIFECYCLE_WITNESS'],
  );

  // Once both projection and decision reach the witness cut, construction and
  // comparison succeed with no one-millisecond grace in either direction.
  const lifecycleBinding = createWaitingPrivateTruthBinding({
    currentSymbol: baseline.currentSymbol,
    currentInstrumentRevision: baseline.currentInstrumentRevision,
    currentInstrumentEvidenceRevision: baseline.currentInstrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: baseline.currentInstrumentSnapshotRevision,
    projection: projectionOneMillisecondAhead,
    lifecycleWitnesses: [lifecycleOneMillisecondAhead],
  });
  const lifecycleFixture = {
    ...waitingFixture({ projectionValue: projectionOneMillisecondAhead }),
    binding: lifecycleBinding,
    lifecycleWitnesses: [lifecycleOneMillisecondAhead],
    evaluatedAtMs: EVALUATED_AT_MS + 1,
  };
  assertWaiting(decideWaitingPrivateTruth(lifecycleFixture), 'CURRENT_NON_SENDABLE', []);
});

test('waiting becomes non-current exactly at the bound lifecycle reconnect deadline', () => {
  const reconnectPlannedAtMs = EVALUATED_AT_MS + 500;
  const witness = spotLifecycleWitness({ reconnectPlannedAtMs });
  const baseline = waitingFixture();
  const prior = createWaitingPrivateTruthBinding({
    currentSymbol: baseline.currentSymbol,
    currentInstrumentRevision: baseline.currentInstrumentRevision,
    currentInstrumentEvidenceRevision: baseline.currentInstrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: baseline.currentInstrumentSnapshotRevision,
    projection: baseline.projection,
    lifecycleWitnesses: [witness],
  });
  assert.equal(prior.validUntilMs, reconnectPlannedAtMs - 1);
  assertWaiting(decideWaitingPrivateTruth({
    ...baseline,
    binding: prior,
    lifecycleWitnesses: [witness],
    evaluatedAtMs: reconnectPlannedAtMs,
  }), 'REVALIDATION_REQUIRED', ['PRIVATE_LIFECYCLE_WITNESS_EXPIRED']);
});

test('every waiting decision reapplies complete lifecycle-to-projection temporal binding', () => {
  const extendedValidUntilMs = EVALUATED_AT_MS + 5_000;
  const nearCutWitness = spotLifecycleWitness({ validUntilMs: extendedValidUntilMs });
  const temporallyForeignWitness = spotLifecycleWitness({
    validUntilMs: extendedValidUntilMs,
    witnessEvaluatedAtMs: EVALUATED_AT_MS + 2_001,
  });
  assert.equal(temporallyForeignWitness.acceptableForOwnerComparison, true);
  const projectionValue = project({
    reconciliationObservation: reconciliation({
      productCutRevisions: {
        SPOT: temporallyForeignWitness.state.ownerRestCut.reconciliationRevision,
        USD_M_PERPETUAL: null,
        MARGIN: null,
      },
    }),
  });
  const baseline = waitingFixture({ projectionValue });
  const canonicalNearCut = createWaitingPrivateTruthBinding({
    currentSymbol: baseline.currentSymbol,
    currentInstrumentRevision: baseline.currentInstrumentRevision,
    currentInstrumentEvidenceRevision: baseline.currentInstrumentEvidenceRevision,
    currentInstrumentSnapshotRevision: baseline.currentInstrumentSnapshotRevision,
    projection: projectionValue,
    lifecycleWitnesses: [nearCutWitness],
  });

  // This record is shape-valid and carries the current lifecycle revision, but
  // it could not have been produced by createWaitingPrivateTruthBinding because
  // the witness is causally later than the projection cut.
  const manuallyShapedPrior = {
    ...canonicalNearCut,
    lifecycleRevisions: [temporallyForeignWitness.lifecycleRevision],
  };
  assertWaiting(decideWaitingPrivateTruth({
    ...baseline,
    binding: manuallyShapedPrior,
    lifecycleWitnesses: [temporallyForeignWitness],
    evaluatedAtMs: baseline.projection.validUntilMs,
  }), 'BLOCKED', ['PRIVATE_WAITING_DECISION_PRECEDES_LIFECYCLE_WITNESS']);
});

test('canonical waiting bindings are immutable, non-authoritative and claim no persistence provenance', () => {
  const fixture = waitingFixture();
  const canonical = createWaitingPrivateTruthBinding({
    currentSymbol: 'BTCUSDT',
    currentInstrumentRevision: INSTRUMENT_REVISION,
    currentInstrumentEvidenceRevision: INSTRUMENT_EVIDENCE_REVISION,
    currentInstrumentSnapshotRevision: INSTRUMENT_SNAPSHOT_REVISION,
    projection: fixture.projection,
    lifecycleWitnesses: [spotLifecycleWitness()],
  });
  assert.equal(canonical.schema, 'L05_PRIVATE_WAITING_BINDING_V1');
  assert.equal(canonical.persistenceProven, false);
  assertNoAuthority(canonical);
  assertDeeplyFrozen(canonical);

  assert.throws(() => createWaitingPrivateTruthBinding({
    currentSymbol: 'BTCUSDT',
    currentInstrumentRevision: INSTRUMENT_REVISION,
    currentInstrumentEvidenceRevision: INSTRUMENT_EVIDENCE_REVISION,
    currentInstrumentSnapshotRevision: INSTRUMENT_SNAPSHOT_REVISION,
    projection: fixture.projection,
    lifecycleWitnesses: [spotLifecycleWitness({
      validUntilMs: EXPECTED_VALID_UNTIL_MS + 1,
    })],
  }), /Foundation-product-cut bound/);
});

test('waiting requires each lifecycle owner REST cut to match its exact Foundation product cut', () => {
  const baseline = waitingFixture();
  assertWaiting(
    decideWaitingPrivateTruth({
      ...baseline,
      lifecycleWitnesses: [spotLifecycleWitness({
        validUntilMs: EXPECTED_VALID_UNTIL_MS + 1,
      })],
    }),
    'BLOCKED',
    ['PRIVATE_LIFECYCLE_RECONCILIATION_PRODUCT_CUT_MISMATCH'],
  );
});

test('waiting rejects cross-product, cross-account, forged and unavailable lifecycle witnesses', () => {
  const baseline = waitingFixture();
  const wrongProduct = createPrivateLifecycleWitness({
    state: createInitialMarginRiskLifecycleState(EVALUATED_AT_MS, ACCOUNT_REALM),
    evaluatedAtMs: EVALUATED_AT_MS,
  });
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, lifecycleWitnesses: [wrongProduct] }),
    'BLOCKED',
    ['PRIVATE_LIFECYCLE_PRODUCT_SET_MISMATCH'],
  );

  const crossAccount = spotLifecycleWitness({
    accountRealmId: 'account-realm-synthetic-b',
  });
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, lifecycleWitnesses: [crossAccount] }),
    'BLOCKED',
    ['PRIVATE_LIFECYCLE_ACCOUNT_REALM_MISMATCH'],
  );

  const unavailable = createPrivateLifecycleWitness({
    state: createInitialSpotPrivateLifecycleState(ACCOUNT_REALM),
    evaluatedAtMs: EVALUATED_AT_MS,
  });
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, lifecycleWitnesses: [unavailable] }),
    'BLOCKED',
    ['PRIVATE_LIFECYCLE_WITNESS_UNACCEPTABLE'],
  );

  assertWaiting(
    decideWaitingPrivateTruth({
      ...baseline,
      lifecycleWitnesses: [forgedSpotLifecycleWitness()],
    }),
    'BLOCKED',
    ['WAITING_PRIVATE_INPUT_REJECTED'],
  );
});

test('every bound instrument, symbol, private, permission, lifecycle and reconciliation revision invalidates exactly', async (t) => {
  const baseline = waitingFixture();
  const cases = [
    ['symbol', { currentSymbol: 'ETHUSDT' }, 'BLOCKED', ['CURRENT_SYMBOL_NOT_PROJECTION_TARGET']],
    ['instrument semantic', { currentInstrumentRevision: `l04-instrument-spec:${'4'.repeat(24)}` }, 'REVALIDATION_REQUIRED', ['INSTRUMENT_REVISION_CHANGED']],
    ['instrument evidence', { currentInstrumentEvidenceRevision: `l04-instrument-source-evidence:${'5'.repeat(24)}` }, 'REVALIDATION_REQUIRED', ['INSTRUMENT_EVIDENCE_REVISION_CHANGED']],
    ['instrument snapshot', { currentInstrumentSnapshotRevision: `l04-instrument-registry-snapshot:${'6'.repeat(24)}` }, 'REVALIDATION_REQUIRED', ['INSTRUMENT_SNAPSHOT_REVISION_CHANGED']],
    ['lifecycle', { lifecycleWitnesses: [spotLifecycleWitness({ subscriptionId: 8 })] }, 'REVALIDATION_REQUIRED', ['LIFECYCLE_REVISIONS_CHANGED']],
  ];
  for (const [name, changes, state, reasons] of cases) {
    await t.test(name, () => {
      const result = decideWaitingPrivateTruth({ ...baseline, ...changes });
      assertWaiting(result, state, reasons);
    });
  }

  await t.test('unbound reconciliation source cut is rejected before comparison', () => {
    const result = decideWaitingPrivateTruth({
      ...baseline,
      reconciliationCutRevision: FOREIGN_RECONCILIATION_CUT_REVISION,
    });
    assertWaiting(result, 'BLOCKED', ['CURRENT_RECONCILIATION_CUT_NOT_PROJECTION_BOUND']);
  });

  await t.test('private projection revision carries reconciliation result identity', () => {
    const changedProjection = project({
      reconciliationObservation: reconciliation({
        resultRevision: `foundation-reconciliation-result:${'b'.repeat(24)}`,
      }),
    });
    const result = decideWaitingPrivateTruth({ ...baseline, projection: changedProjection });
    assertWaiting(result, 'REVALIDATION_REQUIRED', ['PRIVATE_PROJECTION_REVISION_CHANGED']);
  });

  await t.test('forged permission revisions cannot pass full projection validation', () => {
    const changedProjection = structuredClone(baseline.projection);
    changedProjection.permissions[0].revision = 'permission-read-v2';
    changedProjection.projectionRevision = 'private-projection-v2';
    const currentPermissionRevisions = sortedPermissionRevisions(changedProjection);
    const result = decideWaitingPrivateTruth({
      ...baseline,
      projection: changedProjection,
      permissionRevisions: currentPermissionRevisions,
    });
    assertWaiting(result, 'BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED']);
  });
});

test('expired, incomplete, missing and clock-skewed waiting evidence blocks conservatively', () => {
  const baseline = waitingFixture();
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, evaluatedAtMs: baseline.projection.validUntilMs + 1 }),
    'REVALIDATION_REQUIRED',
    ['PRIVATE_LIFECYCLE_WITNESS_EXPIRED'],
  );
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, lifecycleWitnesses: [] }),
    'BLOCKED',
    ['PRIVATE_LIFECYCLE_EVIDENCE_REQUIRED'],
  );
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, reconciliationCutRevision: null }),
    'BLOCKED',
    ['FOUNDATION_RECONCILIATION_CUT_REQUIRED'],
  );

  const incompleteProjection = project({
    facts: factsFor(['SPOT']).filter((item) => item.factKind !== 'SPOT_COMMISSIONS'),
  });
  const incomplete = waitingFixture({ projectionValue: incompleteProjection });
  assertWaiting(
    decideWaitingPrivateTruth(incomplete),
    'BLOCKED',
    ['PRIVATE_PROJECTION_NOT_COMPLETE'],
  );

  assertWaiting(
    decideWaitingPrivateTruth({
      ...baseline,
      permissionRevisions: [
        FOREIGN_READ_PERMISSION_REVISION,
        FOREIGN_EXECUTION_PERMISSION_REVISION,
      ].sort(),
    }),
    'BLOCKED',
    ['CURRENT_PERMISSION_REVISIONS_NOT_PROJECTION_BOUND'],
  );
  assertWaiting(
    decideWaitingPrivateTruth({ ...baseline, evaluatedAtMs: EVALUATED_AT_MS - 2_001 }),
    'BLOCKED',
    ['PRIVATE_WAITING_DECISION_PRECEDES_BINDING'],
  );

  assertWaiting(
    decideWaitingPrivateTruth(waitingFixture({
      binding: { validUntilMs: baseline.projection.validUntilMs + 86_400_000 },
    })),
    'REVALIDATION_REQUIRED',
    ['PRIVATE_WAITING_EVIDENCE_VALIDITY_CHANGED'],
  );

  assertWaiting(
    decideWaitingPrivateTruth({
      ...baseline,
      reconciliationCutRevision: FOREIGN_RECONCILIATION_CUT_REVISION,
    }),
    'BLOCKED',
    ['CURRENT_RECONCILIATION_CUT_NOT_PROJECTION_BOUND'],
  );
});

test('waiting rejects malformed and hostile graphs without invoking accessors or proxy traps', () => {
  const baseline = waitingFixture();
  const rejected = [
    { ...waitingFixture(), unexpected: true },
    { ...waitingFixture(), currentSymbol: 'btcusdt' },
    { ...waitingFixture(), permissionRevisions: [READ_PERMISSION_REVISION, READ_PERMISSION_REVISION] },
    { ...waitingFixture(), lifecycleWitnesses: [forgedSpotLifecycleWitness()] },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        permissionRevisions: [...baseline.binding.permissionRevisions].reverse(),
      },
    },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        lifecycleRevisions: ['spot-lifecycle-revision-v1', 'spot-lifecycle-revision-v1'],
      },
    },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        instrumentRevision: 'instrument-semantic-v1',
      },
    },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        privateProjectionRevision: 'A'.repeat(64),
      },
    },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        reconciliationCutRevision: `l05pcut_${'g'.repeat(64)}`,
      },
    },
    {
      ...baseline,
      binding: {
        ...baseline.binding,
        validUntilMs: EVALUATED_AT_MS - 1,
      },
    },
  ];
  for (const candidate of rejected) {
    assertWaiting(decideWaitingPrivateTruth(candidate), 'BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED']);
  }
  assertWaiting(
    decideWaitingPrivateTruth({
      ...waitingFixture(),
      permissionRevisions: [FOREIGN_READ_PERMISSION_REVISION],
    }),
    'BLOCKED',
    ['PRIVATE_PERMISSION_EVIDENCE_REQUIRED'],
  );

  let getterCalls = 0;
  const accessor = waitingFixture();
  Object.defineProperty(accessor, 'binding', {
    enumerable: true,
    get() { getterCalls += 1; return {}; },
  });
  assertWaiting(decideWaitingPrivateTruth(accessor), 'BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED']);
  assert.equal(getterCalls, 0);

  const trapCalls = [];
  const activeProxy = new Proxy({}, {
    get() { trapCalls.push('get'); throw new Error('HOSTILE_GET'); },
    getOwnPropertyDescriptor() { trapCalls.push('descriptor'); throw new Error('HOSTILE_DESCRIPTOR'); },
    getPrototypeOf() { trapCalls.push('prototype'); throw new Error('HOSTILE_PROTOTYPE'); },
    ownKeys() { trapCalls.push('keys'); throw new Error('HOSTILE_KEYS'); },
  });
  assertWaiting(decideWaitingPrivateTruth(activeProxy), 'BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED']);
  assert.deepEqual(trapCalls, []);

  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  assertWaiting(decideWaitingPrivateTruth(revoked), 'BLOCKED', ['WAITING_PRIVATE_INPUT_REJECTED']);
});

test('waiting decisions are deterministic, detached, immutable and non-authoritative in every state', () => {
  const input = waitingFixture();
  const first = decideWaitingPrivateTruth(input);
  const second = decideWaitingPrivateTruth(structuredClone(input));
  assert.deepEqual(second, first);

  input.binding.symbol = 'ETHUSDT';
  input.lifecycleWitnesses[0].lifecycleRevision = 'caller-mutated-lifecycle';
  assert.equal(first.state, 'CURRENT_NON_SENDABLE');
  assert.deepEqual(first.reasonCodes, []);
  assertNoAuthority(first);
  assertDeeplyFrozen(first);

  const changed = decideWaitingPrivateTruth(waitingFixture({
    input: { currentInstrumentRevision: `l04-instrument-spec:${'4'.repeat(24)}` },
  }));
  assert.equal(changed.state, 'REVALIDATION_REQUIRED');
  assertNoAuthority(changed);

  const blocked = decideWaitingPrivateTruth(null);
  assert.equal(blocked.state, 'BLOCKED');
  assertNoAuthority(blocked);
  assertDeeplyFrozen(blocked);
});
