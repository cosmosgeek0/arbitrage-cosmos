import assert from 'node:assert/strict';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  createInitialSpotPrivateLifecycleState,
  createPrivateLifecycleWitness,
  createSpotRealmBoundRevision,
  derivePrivateTruthSourceCutRevision,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  reduceSpotPrivateLifecycle,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const FACT_SCHEMA = 'L05_BINANCE_PRIVATE_FACT_V1';
const ACCOUNT_FINGERPRINT = 'account-fingerprint-l06-fixture';
const SPOT_FACTS = Object.freeze([
  'SPOT_PERMISSIONS', 'SPOT_ACCOUNT', 'SPOT_OPEN_ORDERS', 'SPOT_TRADES',
  'SPOT_COMMISSIONS', 'SPOT_ACCOUNT_STATUS', 'SPOT_TRADING_STATUS',
]);
const SPOT_CONTRACT_IDS = Object.freeze({
  SPOT_PERMISSIONS: 'SPOT_API_KEY_PERMISSIONS',
  SPOT_ACCOUNT: 'SPOT_ACCOUNT_BALANCES',
  SPOT_OPEN_ORDERS: 'SPOT_OPEN_ORDERS_QUERY',
  SPOT_TRADES: 'SPOT_MY_TRADES_QUERY',
  SPOT_COMMISSIONS: 'SPOT_COMMISSION_QUERY',
  SPOT_ACCOUNT_STATUS: 'SPOT_ACCOUNT_STATUS',
  SPOT_TRADING_STATUS: 'SPOT_ACCOUNT_API_TRADING_STATUS',
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
const RATE = Object.freeze({ maker: '0.001', taker: '0.001', buyer: '0', seller: '0' });

function permissionPayload(overrides = {}) {
  return {
    ipRestrict: true,
    enableReading: false,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: false,
    enableFutures: false,
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: false,
    enablePortfolioMarginTrading: false,
    ...overrides,
  };
}

function profile(profileClass, accountRealmId) {
  const execution = profileClass === 'EXECUTION_KEY';
  return {
    profileClass,
    profileId: execution ? 'execution-profile-l06' : 'read-profile-l06',
    accountRealmId,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload(execution
      ? { enableSpotAndMarginTrading: true }
      : { enableReading: true }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
  };
}

function decisions(accountRealmId) {
  return evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    readProfile: profile('READ_KEY', accountRealmId),
    executionProfile: profile('EXECUTION_KEY', accountRealmId),
  });
}

function queryCoverage(kind, evaluatedAtMs) {
  if (kind === 'SPOT_ACCOUNT') {
    return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE, omitZeroBalances: false };
  }
  if (kind === 'SPOT_TRADES') {
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

function factValue(kind, profileId, targetSymbol, evaluatedAtMs, permissionDecisions) {
  switch (kind) {
    case 'SPOT_PERMISSIONS': {
      const decision = permissionDecisions.find((item) => item.profileId === profileId);
      assert.ok(decision);
      return { ...decision.permissions, createTime: evaluatedAtMs - 10_000 };
    }
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
        updateTime: evaluatedAtMs - 100,
        accountType: 'SPOT',
        balances: [],
        permissions: ['SPOT'],
        uid: '1',
      };
    case 'SPOT_OPEN_ORDERS':
    case 'SPOT_TRADES':
      return [];
    case 'SPOT_COMMISSIONS':
      return {
        symbol: targetSymbol,
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
      return { data: 'Normal' };
    case 'SPOT_TRADING_STATUS':
      return {
        data: {
          isLocked: false,
          plannedRecoverTime: null,
          triggerCondition: { GCR: 0, IFER: 0, UFR: 0 },
          updateTime: evaluatedAtMs - 100,
        },
      };
    default:
      throw new Error(`missing L06 Spot fact fixture: ${kind}`);
  }
}

function normalizedFact({
  kind,
  index,
  profileId,
  accountRealmId,
  targetSymbol,
  evaluatedAtMs,
  permissionDecisions,
}) {
  const contractId = SPOT_CONTRACT_IDS[kind];
  const contract = resolvePrivateFactContract(kind, L05_BINANCE_MATRIX_SHA256, contractId).contract;
  assert.ok(contract);
  const query = kind === 'SPOT_OPEN_ORDERS'
    ? { queryScope: 'ALL_SYMBOLS', querySymbol: null }
    : ['SPOT_TRADES', 'SPOT_COMMISSIONS'].includes(kind)
      ? { queryScope: 'SYMBOL', querySymbol: targetSymbol }
      : { queryScope: 'ACCOUNT_WIDE', querySymbol: null };
  return normalizePrivateFactEvidence({
    schema: FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: 'SPOT',
    environment: 'PRODUCTION',
    realm: contract.realm,
    accountRealmId,
    profileId,
    contractId,
    ...query,
    queryAsset: null,
    queryType: null,
    marginMode: null,
    queryCoverage: queryCoverage(kind, evaluatedAtMs),
    sourceId: contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: `private-receipt:${index.toString(16).padStart(24, '0')}`,
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: evaluatedAtMs - 100,
    receivedAtMs: evaluatedAtMs - 50,
    maxAgeMs: 1_000,
    value: factValue(kind, profileId, targetSymbol, evaluatedAtMs, permissionDecisions),
  }, evaluatedAtMs);
}

function spotFacts(accountRealmId, targetSymbol, evaluatedAtMs, permissionDecisions) {
  const facts = [];
  let index = 1;
  for (const kind of SPOT_FACTS) {
    if (kind === 'SPOT_PERMISSIONS') {
      facts.push(normalizedFact({
        kind, index, profileId: 'read-profile-l06', accountRealmId,
        targetSymbol, evaluatedAtMs, permissionDecisions,
      }));
      index += 1;
      facts.push(normalizedFact({
        kind, index, profileId: 'execution-profile-l06', accountRealmId,
        targetSymbol, evaluatedAtMs, permissionDecisions,
      }));
    } else {
      facts.push(normalizedFact({
        kind, index, profileId: 'read-profile-l06', accountRealmId,
        targetSymbol, evaluatedAtMs, permissionDecisions,
      }));
    }
    index += 1;
  }
  return facts;
}

function applySpot(state, observation) {
  const result = reduceSpotPrivateLifecycle(state, observation);
  assert.equal(result.accepted, true, JSON.stringify(result.issues));
  return result.state;
}

function lifecycleWitness(accountRealmId, evaluatedAtMs) {
  const generation = 1;
  let state = createInitialSpotPrivateLifecycleState(accountRealmId);
  state = applySpot(state, {
    kind: 'CONNECTION_OPENED', accountRealmId, generation,
    observedAtMs: evaluatedAtMs - 300, connectedAtMs: evaluatedAtMs - 300,
    reconnectPlannedAtMs: evaluatedAtMs + 82_800_000,
    sessionActiveSubscriptionCount: 0, sessionLifetimeSubscriptionCount: 0,
  });
  state = applySpot(state, {
    kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED', accountRealmId, generation,
    observedAtMs: evaluatedAtMs - 250, subscriptionId: 11,
    sessionActiveSubscriptionCount: 1, sessionLifetimeSubscriptionCount: 1,
  });
  const eventContentRevision = 'spot_content_00000000000000000000000000000011';
  const eventRevision = createSpotRealmBoundRevision('spot_event', accountRealmId, {
    generation,
    eventKind: 'ACCOUNT',
    contentRevision: eventContentRevision,
    exchangeEventTimeMs: evaluatedAtMs - 200,
    receiptTimeMs: evaluatedAtMs - 150,
  });
  state = applySpot(state, {
    kind: 'PRIVATE_EVENT_OBSERVED', accountRealmId, generation,
    eventKind: 'ACCOUNT', eventRevision, contentRevision: eventContentRevision,
    exchangeEventTimeMs: evaluatedAtMs - 200,
    receiptTimeMs: evaluatedAtMs - 150,
  });
  const cut = {
    generation,
    reconciledAtMs: evaluatedAtMs,
    validUntilMs: evaluatedAtMs + 1_000,
    throughEventRevision: eventRevision,
    throughExchangeEventTimeMs: evaluatedAtMs - 200,
  };
  state = applySpot(state, {
    kind: 'OWNER_REST_RECONCILIATION_OBSERVED', accountRealmId,
    ...cut,
    reconciliationRevision: createSpotRealmBoundRevision('spot_rest', accountRealmId, cut),
  });
  return createPrivateLifecycleWitness({ state, evaluatedAtMs });
}

export function buildL05SpotOwnerEvidence({
  accountRealmId,
  targetSymbol,
  evaluatedAtMs,
  resultRevision,
}) {
  if (targetSymbol !== 'BTCUSDT') throw new TypeError('L06 fixture supports BTCUSDT only');
  const permissionDecisions = decisions(accountRealmId);
  const facts = spotFacts(accountRealmId, targetSymbol, evaluatedAtMs, permissionDecisions);
  const witness = lifecycleWitness(accountRealmId, evaluatedAtMs);
  const cutInput = {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId,
    targetSymbol,
    evaluatedAtMs,
    facts,
    permissions: permissionDecisions,
  };
  const sourceCutRevision = derivePrivateTruthSourceCutRevision(cutInput);
  const tradeFact = facts.find((fact) => fact.factKind === 'SPOT_TRADES');
  assert.ok(tradeFact);
  const historyCoverageRequirements = [{
    owner: 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE',
    status: 'EXACT_REQUIREMENT',
    requirementRevision: `foundation-history-coverage-requirement:${'1'.padStart(24, '0')}`,
    accountRealmId,
    posture: 'SPOT_NEW_EXPOSURE',
    targetSymbol,
    factKind: 'SPOT_TRADES',
    factEvidenceRevision: tradeFact.evidenceRevision,
    sourceCutRevision,
    startTimeMs: tradeFact.queryCoverage.startTimeMs,
    endTimeMs: tradeFact.queryCoverage.endTimeMs,
    executionAuthority: 'NONE',
  }];
  const projection = projectPrivateTruth({
    ...cutInput,
    historyCoverageRequirements,
    reconciliationObservation: {
      owner: 'FOUNDATION_RECONCILIATION',
      status: 'EXACT',
      resultRevision,
      sourceCutRevision,
      productCutRevisions: {
        SPOT: witness.state.ownerRestCut.reconciliationRevision,
        USD_M_PERPETUAL: null,
        MARGIN: null,
      },
      observedAtMs: evaluatedAtMs,
      executionAuthority: 'NONE',
    },
  });
  assert.equal(projection.entryEvidenceComplete, true, JSON.stringify(projection.reasonCodes));
  return { projection, witness };
}
