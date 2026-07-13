import assert from 'node:assert/strict';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  L05_PRIVATE_GAP_SOURCE_ID,
  derivePrivateTruthSourceCutRevision,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  resolvePrivateFactContract,
  validatePrivateTruthProjection,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const POSTURE = 'USDM_NEW_EXPOSURE';
const PRODUCT = 'USD_M_PERPETUAL';
const READ_PROFILE_ID = 'profile.normal-basis-l09.read';
const EXECUTION_PROFILE_ID = 'profile.normal-basis-l09.execution';
const ACCOUNT_FINGERPRINT_REF = 'account-fingerprint.normal-basis-l09';

const REQUIRED_USDM_FACTS = Object.freeze([
  'USDM_PERMISSIONS',
  'USDM_ACCOUNT',
  'USDM_BALANCE',
  'USDM_POSITIONS',
  'USDM_OPEN_ORDERS',
  'USDM_ALGO_OPEN_ORDERS',
  'USDM_TRADES',
  'USDM_COMMISSIONS',
  'USDM_INCOME',
  'USDM_ADL',
  'USDM_ACCOUNT_CONFIGURATION',
  'USDM_SYMBOL_CONFIGURATION',
  'USDM_ACCOUNT_STATUS',
  'USDM_TRADING_STATUS',
  'USDM_MULTI_ASSETS_MODE',
  'USDM_POSITION_MODE',
]);

const CONTRACT_IDS = Object.freeze({
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
});

const GAP_REASONS = Object.freeze({
  USDM_ALGO_OPEN_ORDERS: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS',
  USDM_COMMISSIONS: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_COMMISSION',
  USDM_INCOME: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_INCOME',
  USDM_ADL: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ADL',
  USDM_ACCOUNT_CONFIGURATION: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_ACCOUNT_CONFIGURATION',
  USDM_SYMBOL_CONFIGURATION: 'UNAVAILABLE_L02_CONTRACT_GAP_USDM_SYMBOL_CONFIGURATION',
});

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
  asset: null,
});

function permissions(profileId, evaluatedAtMs) {
  const read = profileId === READ_PROFILE_ID;
  return {
    ipRestrict: true,
    createTime: evaluatedAtMs - 10_000,
    enableReading: read,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: false,
    enableFutures: !read,
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: false,
    enablePortfolioMarginTrading: false,
  };
}

function profile(profileClass, accountRealmId) {
  const read = profileClass === 'READ_KEY';
  return {
    profileClass,
    profileId: read ? READ_PROFILE_ID : EXECUTION_PROFILE_ID,
    accountRealmId,
    accountFingerprintRef: ACCOUNT_FINGERPRINT_REF,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: {
      ipRestrict: true,
      enableReading: read,
      enableWithdrawals: false,
      enableInternalTransfer: false,
      enableMargin: false,
      enableFutures: !read,
      permitsUniversalTransfer: false,
      enableVanillaOptions: false,
      enableFixApiTrade: false,
      enableFixReadOnly: false,
      enableSpotAndMarginTrading: false,
      enablePortfolioMarginTrading: false,
    },
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: false,
    usdmMultiAssetsMargin: false,
    marginMode: 'UNKNOWN',
  };
}

function permissionDecisions(accountRealmId) {
  return evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: POSTURE,
    accountRealmId,
    accountFingerprintRef: ACCOUNT_FINGERPRINT_REF,
    readProfile: profile('READ_KEY', accountRealmId),
    executionProfile: profile('EXECUTION_KEY', accountRealmId),
  });
}

function tradingStatus(evaluatedAtMs) {
  return {
    data: {
      isLocked: false,
      plannedRecoverTime: null,
      triggerCondition: { GCR: 0, IFER: 0, UFR: 0 },
      updateTime: evaluatedAtMs - 100,
    },
  };
}

function valueFor(kind, profileId, targetSymbol, evaluatedAtMs) {
  switch (kind) {
    case 'USDM_PERMISSIONS':
      return permissions(profileId, evaluatedAtMs);
    case 'USDM_ACCOUNT':
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
          symbol: targetSymbol,
          positionSide: 'BOTH',
          positionAmt: '0.01',
          unrealizedProfit: '0.1',
          isolatedMargin: '0',
          notional: '600.1',
          isolatedWallet: '0',
          initialMargin: '60',
          maintMargin: '3',
          updateTime: evaluatedAtMs - 100,
        }],
      };
    case 'USDM_BALANCE':
      return [];
    case 'USDM_POSITIONS':
      return [{
        symbol: targetSymbol,
        positionSide: 'BOTH',
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
        updateTime: evaluatedAtMs - 100,
      }];
    case 'USDM_OPEN_ORDERS':
      return [{
        avgPrice: '0',
        clientOrderId: 'normal-basis-l09-usdm-order-1',
        cumQuote: '0',
        executedQty: '0',
        orderId: 101,
        origQty: '0.01',
        origType: 'LIMIT',
        price: '59000',
        reduceOnly: false,
        side: 'BUY',
        positionSide: 'BOTH',
        status: 'NEW',
        stopPrice: '0',
        closePosition: false,
        symbol: targetSymbol,
        time: evaluatedAtMs - 200,
        timeInForce: 'GTC',
        type: 'LIMIT',
        activatePrice: '0',
        priceRate: '0',
        updateTime: evaluatedAtMs - 100,
        workingType: 'CONTRACT_PRICE',
        priceProtect: false,
        priceMatch: 'NONE',
        selfTradePreventionMode: 'NONE',
        goodTillDate: 0,
      }];
    case 'USDM_TRADES':
      return [{
        symbol: targetSymbol,
        id: 201,
        orderId: 101,
        price: '60000',
        qty: '0.01',
        quoteQty: '600',
        commission: '0.01',
        commissionAsset: 'USDT',
        realizedPnl: '0',
        side: 'BUY',
        positionSide: 'BOTH',
        buyer: true,
        maker: false,
        time: evaluatedAtMs - 100,
      }];
    case 'USDM_ACCOUNT_STATUS':
      return { data: 'Normal' };
    case 'USDM_TRADING_STATUS':
      return tradingStatus(evaluatedAtMs);
    case 'USDM_MULTI_ASSETS_MODE':
      return { multiAssetsMargin: false };
    case 'USDM_POSITION_MODE':
      return { dualSidePosition: false };
    case 'USDM_ALGO_OPEN_ORDERS':
    case 'USDM_COMMISSIONS':
    case 'USDM_INCOME':
    case 'USDM_ADL':
    case 'USDM_ACCOUNT_CONFIGURATION':
    case 'USDM_SYMBOL_CONFIGURATION':
      return null;
    default:
      throw new TypeError(`missing L05 USD-M fixture value for ${kind}`);
  }
}

function queryMetadata(kind, targetSymbol, gap) {
  if (gap) {
    return {
      queryScope: 'ACCOUNT_WIDE',
      querySymbol: null,
      queryAsset: null,
      queryType: null,
      marginMode: null,
    };
  }
  if (kind === 'USDM_OPEN_ORDERS') {
    return {
      queryScope: 'ALL_SYMBOLS',
      querySymbol: null,
      queryAsset: null,
      queryType: null,
      marginMode: null,
    };
  }
  if (kind === 'USDM_TRADES') {
    return {
      queryScope: 'SYMBOL',
      querySymbol: targetSymbol,
      queryAsset: null,
      queryType: null,
      marginMode: null,
    };
  }
  return {
    queryScope: 'ACCOUNT_WIDE',
    querySymbol: null,
    queryAsset: null,
    queryType: null,
    marginMode: null,
  };
}

function queryCoverage(kind, evaluatedAtMs, gap) {
  if (gap) return { kind: 'UNAVAILABLE_GAP', ...NULL_QUERY_COVERAGE };
  if (kind === 'USDM_TRADES') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: evaluatedAtMs - 60_100,
      endTimeMs: evaluatedAtMs - 100,
      limit: 1_000,
    };
  }
  return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE };
}

function normalizedFact({
  kind,
  index,
  profileId,
  accountRealmId,
  targetSymbol,
  evaluatedAtMs,
}) {
  const gapReason = GAP_REASONS[kind] ?? null;
  const gap = gapReason !== null;
  const resolution = resolvePrivateFactContract(
    kind,
    L05_BINANCE_MATRIX_SHA256,
    CONTRACT_IDS[kind],
  );
  assert.equal(resolution.policy.gapReason, gapReason);
  const sourceTimeMs = gap ? null : evaluatedAtMs - 100;
  return normalizePrivateFactEvidence({
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: PRODUCT,
    environment: 'PRODUCTION',
    realm: resolution.contract?.realm ?? 'PRIVATE_ACCOUNT',
    accountRealmId,
    profileId: gap ? null : profileId,
    contractId: CONTRACT_IDS[kind],
    ...queryMetadata(kind, targetSymbol, gap),
    queryCoverage: queryCoverage(kind, evaluatedAtMs, gap),
    sourceId: resolution.contract?.sourceIds[0] ?? L05_PRIVATE_GAP_SOURCE_ID,
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: `private-receipt:${index.toString(16).padStart(24, '0')}`,
    readState: gap ? 'UNAVAILABLE' : 'OK',
    authority: gap ? 'UNAVAILABLE' : 'SYNTHETIC_TEST',
    completeness: gap ? 'UNAVAILABLE' : 'COMPLETE',
    sourceTimeMs,
    receivedAtMs: evaluatedAtMs - 50,
    maxAgeMs: 1_000,
    value: valueFor(kind, profileId, targetSymbol, evaluatedAtMs),
  }, evaluatedAtMs);
}

function sourceFacts(accountRealmId, targetSymbol, evaluatedAtMs) {
  const facts = [];
  let index = 1;
  for (const kind of REQUIRED_USDM_FACTS) {
    if (kind === 'USDM_PERMISSIONS') {
      facts.push(normalizedFact({
        kind,
        index,
        profileId: READ_PROFILE_ID,
        accountRealmId,
        targetSymbol,
        evaluatedAtMs,
      }));
      index += 1;
      facts.push(normalizedFact({
        kind,
        index,
        profileId: EXECUTION_PROFILE_ID,
        accountRealmId,
        targetSymbol,
        evaluatedAtMs,
      }));
    } else {
      facts.push(normalizedFact({
        kind,
        index,
        profileId: READ_PROFILE_ID,
        accountRealmId,
        targetSymbol,
        evaluatedAtMs,
      }));
    }
    index += 1;
  }
  return facts;
}

function sideBearingRows(fact) {
  if (fact.factKind === 'USDM_ACCOUNT') return fact.value.positions;
  if (['USDM_POSITIONS', 'USDM_OPEN_ORDERS', 'USDM_TRADES'].includes(fact.factKind)) {
    return fact.value;
  }
  return [];
}

export function buildNormalBasisL05Projection({
  accountRealmId,
  targetSymbol,
  evaluatedAtMs,
}) {
  const facts = sourceFacts(accountRealmId, targetSymbol, evaluatedAtMs);
  const decisions = permissionDecisions(accountRealmId);
  const cutInput = {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: POSTURE,
    accountRealmId,
    targetSymbol,
    evaluatedAtMs,
    facts,
    permissions: decisions,
  };
  const sourceCutRevision = derivePrivateTruthSourceCutRevision(cutInput);
  const tradeFact = facts.find((fact) => fact.factKind === 'USDM_TRADES');
  assert.ok(tradeFact);
  const projection = validatePrivateTruthProjection(projectPrivateTruth({
    ...cutInput,
    historyCoverageRequirements: [{
      owner: 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE',
      status: 'EXACT_REQUIREMENT',
      requirementRevision: `foundation-history-coverage-requirement:${tradeFact.evidenceRevision.slice(-24)}`,
      accountRealmId,
      posture: POSTURE,
      targetSymbol,
      factKind: 'USDM_TRADES',
      factEvidenceRevision: tradeFact.evidenceRevision,
      sourceCutRevision,
      startTimeMs: tradeFact.queryCoverage.startTimeMs,
      endTimeMs: tradeFact.queryCoverage.endTimeMs,
      executionAuthority: 'NONE',
    }],
    reconciliationObservation: {
      owner: 'FOUNDATION_RECONCILIATION',
      status: 'EXACT',
      resultRevision: `foundation-reconciliation-result:${sourceCutRevision.slice(-24)}`,
      sourceCutRevision,
      productCutRevisions: {
        SPOT: null,
        USD_M_PERPETUAL: `usdm_rest_${sourceCutRevision.slice(-32)}`,
        MARGIN: null,
      },
      observedAtMs: evaluatedAtMs,
      executionAuthority: 'NONE',
    },
  }));

  assert.equal(projection.posture, POSTURE);
  assert.equal(projection.completeness, 'PARTIAL');
  assert.equal(projection.entryEvidenceComplete, false);
  assert.equal(projection.futures.completeness, 'PARTIAL');
  assert.deepEqual(
    new Set(projection.sourceFacts.map((fact) => fact.factKind)),
    new Set(REQUIRED_USDM_FACTS),
  );
  assert.equal(projection.permissions.length, 2);
  assert.ok(projection.permissions.every((decision) => (
    decision.usdmDualSidePosition === false
    && decision.usdmMultiAssetsMargin === false
  )));
  const positionMode = projection.sourceFacts.filter((fact) => (
    fact.factKind === 'USDM_POSITION_MODE'
  ));
  assert.equal(positionMode.length, 1);
  assert.equal(positionMode[0].value.dualSidePosition, false);
  for (const fact of projection.sourceFacts) {
    assert.ok(sideBearingRows(fact).every((row) => row.positionSide === 'BOTH'));
  }
  for (const [kind, reason] of Object.entries(GAP_REASONS)) {
    assert.ok(projection.reasonCodes.includes(`FACT_UNUSABLE_${kind}`));
    assert.ok(projection.reasonCodes.includes(reason));
  }
  return projection;
}
