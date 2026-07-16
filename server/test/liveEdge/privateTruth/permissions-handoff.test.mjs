import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  L05_PRIVATE_HANDOFF_SCHEMA,
  createPrivateComparisonHandoff,
  derivePrivateTruthSourceCutRevision,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const T0 = 1_800_000_000_000;
const ACCOUNT_REALM = 'account-realm-1';
const ACCOUNT_FINGERPRINT = 'account-fingerprint-1';
const FACT_SCHEMA = 'L05_BINANCE_PRIVATE_FACT_V1';
const FOUNDATION_RESULT_REVISION = `foundation-reconciliation-result:${'a'.repeat(24)}`;
const FOREIGN_ORDER_REFERENCE = `foreign-order:${'b'.repeat(24)}`;
const FOREIGN_POSITION_REFERENCE = `foreign-position:${'c'.repeat(24)}`;
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

function spotQueryCoverage(kind) {
  if (kind === 'SPOT_ACCOUNT') {
    return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE, omitZeroBalances: false };
  }
  if (kind === 'SPOT_TRADES') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: T0 - 60_100,
      endTimeMs: T0 - 100,
      limit: 1_000,
    };
  }
  return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE };
}

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

function readProfile(overrides = {}) {
  return {
    profileClass: 'READ_KEY',
    profileId: 'read-profile-1',
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({ enableReading: true }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
    ...overrides,
  };
}

function executionProfile(overrides = {}) {
  return {
    profileClass: 'EXECUTION_KEY',
    profileId: 'execution-profile-1',
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({ enableSpotAndMarginTrading: true }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
    ...overrides,
  };
}

function permissionInput(overrides = {}) {
  return {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    readProfile: readProfile(),
    executionProfile: executionProfile(),
    ...overrides,
  };
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

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

function decisions(input = permissionInput()) {
  return evaluatePrivatePermissions(input);
}

test('distinct READ_KEY and EXECUTION_KEY profiles produce immutable evidence-only decisions', () => {
  const result = decisions();
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.profileClass), ['READ_KEY', 'EXECUTION_KEY']);
  assert.equal(new Set(result.map((item) => item.profileId)).size, 2);
  assert.equal(new Set(result.map((item) => item.revision)).size, 2);
  for (const item of result) {
    assert.equal(item.acceptableForOwnerReview, true);
    assert.deepEqual(item.reasonCodes, []);
    assertNoAuthority(item);
  }
  assertDeeplyFrozen(result);
});

test('permission decisions are deterministic and detached from mutable input', () => {
  const input = permissionInput();
  const first = decisions(input);
  const same = decisions(permissionInput());
  assert.deepEqual(first, same);
  input.readProfile.permissions.enableReading = false;
  input.executionProfile.permissions.enableWithdrawals = true;
  assert.deepEqual(first, same, 'later fixture mutation cannot alter the prior decision');
  const changed = decisions(input);
  assert.notEqual(changed[0].revision, first[0].revision);
  assert.notEqual(changed[1].revision, first[1].revision);
  assert.ok(changed[0].reasonCodes.includes('READ_PERMISSION_MISSING'));
  assert.ok(changed[1].reasonCodes.includes('WITHDRAWALS_ENABLED'));
});

const permissionFailures = [
  {
    name: 'combined profile identity',
    reason: 'COMBINED_PROFILE_OWNER_EXCEPTION_REQUIRED',
    input: () => permissionInput({ executionProfile: executionProfile({ profileId: 'read-profile-1' }) }),
  },
  {
    name: 'account realm mismatch',
    reason: 'ACCOUNT_REALM_MISMATCH',
    input: () => permissionInput({ readProfile: readProfile({ accountRealmId: 'realm-other' }) }),
  },
  {
    name: 'account fingerprint mismatch',
    reason: 'ACCOUNT_FINGERPRINT_MISMATCH',
    input: () => permissionInput({ executionProfile: executionProfile({ accountFingerprintRef: 'account-fingerprint-other' }) }),
  },
  {
    name: 'fixed IP missing',
    reason: 'FIXED_IP_RESTRICTION_MISSING',
    input: () => permissionInput({ readProfile: readProfile({ permissions: permissionPayload({ enableReading: true, ipRestrict: false }) }) }),
  },
  {
    name: 'deployed egress mismatch',
    reason: 'DEPLOYED_EGRESS_MISMATCH',
    input: () => permissionInput({ executionProfile: executionProfile({ deployedEgressMatch: false }) }),
  },
  {
    name: 'deployed egress unknown',
    reason: 'DEPLOYED_EGRESS_MATCH_UNKNOWN',
    input: () => permissionInput({ executionProfile: executionProfile({ deployedEgressMatch: null }) }),
  },
  {
    name: 'withdrawals enabled',
    reason: 'WITHDRAWALS_ENABLED',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableWithdrawals: true }) }) }),
  },
  {
    name: 'internal transfer enabled',
    reason: 'INTERNAL_TRANSFER_ENABLED',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableInternalTransfer: true }) }) }),
  },
  {
    name: 'universal transfer enabled',
    reason: 'UNIVERSAL_TRANSFER_ENABLED',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload({ enableSpotAndMarginTrading: true, permitsUniversalTransfer: true }) }) }),
  },
  {
    name: 'Spot product permission missing',
    reason: 'SPOT_MARGIN_TRADE_PERMISSION_MISSING',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload() }) }),
  },
  {
    name: 'unrequired Futures permission',
    reason: 'UNREQUIRED_FUTURES_PERMISSION_ENABLED',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableFutures: true }) }) }),
  },
  {
    name: 'read profile execution permission',
    reason: 'READ_PROFILE_HAS_EXECUTION_PERMISSION',
    input: () => permissionInput({ readProfile: readProfile({ permissions: permissionPayload({ enableReading: true, enableFutures: true }) }) }),
  },
  {
    name: 'abnormal account status',
    reason: 'ACCOUNT_STATUS_NOT_NORMAL',
    input: () => permissionInput({ readProfile: readProfile({ accountStatus: 'ABNORMAL' }) }),
  },
  {
    name: 'API trading locked',
    reason: 'API_TRADING_LOCKED',
    input: () => permissionInput({ executionProfile: executionProfile({ apiTradingLocked: true }) }),
  },
  {
    name: 'API trading lock unknown',
    reason: 'API_TRADING_LOCK_STATUS_UNKNOWN',
    input: () => permissionInput({ executionProfile: executionProfile({ apiTradingLocked: null }) }),
  },
  {
    name: 'Portfolio Margin enabled',
    reason: 'PORTFOLIO_MARGIN_UNSUPPORTED',
    input: () => permissionInput({ executionProfile: executionProfile({ permissions: permissionPayload({ enableSpotAndMarginTrading: true, enablePortfolioMarginTrading: true }) }) }),
  },
];

for (const vector of permissionFailures) {
  test(`permission posture fails closed: ${vector.name}`, () => {
    const result = decisions(vector.input());
    assert.ok(result.some((item) => item.reasonCodes.includes(vector.reason)));
    assert.ok(result.some((item) => !item.acceptableForOwnerReview));
    for (const item of result) assertNoAuthority(item);
  });
}

test('USD-M requires the exact Futures permission and supported one-way/single-asset modes', () => {
  const valid = decisions(permissionInput({
    posture: 'USDM_NEW_EXPOSURE',
    readProfile: readProfile({ usdmDualSidePosition: false, usdmMultiAssetsMargin: false }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableFutures: true }),
      usdmDualSidePosition: false,
      usdmMultiAssetsMargin: false,
    }),
  }));
  assert.ok(valid.every((item) => item.acceptableForOwnerReview));

  const hedge = decisions(permissionInput({
    posture: 'USDM_NEW_EXPOSURE',
    readProfile: readProfile({ usdmDualSidePosition: true, usdmMultiAssetsMargin: false }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableFutures: true }),
      usdmDualSidePosition: true,
      usdmMultiAssetsMargin: false,
    }),
  }));
  assert.ok(hedge.every((item) => item.reasonCodes.includes('USDM_HEDGE_MODE_UNSUPPORTED')));

  const multiAsset = decisions(permissionInput({
    posture: 'USDM_NEW_EXPOSURE',
    readProfile: readProfile({ usdmDualSidePosition: false, usdmMultiAssetsMargin: true }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableFutures: true }),
      usdmDualSidePosition: false,
      usdmMultiAssetsMargin: true,
    }),
  }));
  assert.ok(multiAsset.every((item) => item.reasonCodes.includes('USDM_MULTI_ASSETS_UNSUPPORTED')));
});

test('USD-M profile mode mismatches are explicit and cannot borrow sibling posture', () => {
  const result = decisions(permissionInput({
    posture: 'USDM_NEW_EXPOSURE',
    readProfile: readProfile({ usdmDualSidePosition: false, usdmMultiAssetsMargin: false }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableFutures: true }),
      usdmDualSidePosition: true,
      usdmMultiAssetsMargin: true,
    }),
  }));
  for (const item of result) {
    assert.ok(item.reasonCodes.includes('USDM_POSITION_MODE_PROFILE_MISMATCH'));
    assert.ok(item.reasonCodes.includes('USDM_ASSET_MODE_PROFILE_MISMATCH'));
    assert.equal(item.acceptableForOwnerReview, false);
  }
});

test('Margin requires its exact product permissions and current cross mode', () => {
  const valid = decisions(permissionInput({
    posture: 'MARGIN_NEW_EXPOSURE',
    readProfile: readProfile({ marginMode: 'CROSS_CLASSIC' }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableMargin: true }),
      marginMode: 'CROSS_CLASSIC',
    }),
  }));
  assert.ok(valid.every((item) => item.acceptableForOwnerReview));

  const missingPermission = decisions(permissionInput({
    posture: 'MARGIN_NEW_EXPOSURE',
    readProfile: readProfile({ marginMode: 'CROSS_CLASSIC' }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableSpotAndMarginTrading: true }),
      marginMode: 'CROSS_CLASSIC',
    }),
  }));
  assert.ok(missingPermission[1].reasonCodes.includes('MARGIN_PERMISSION_MISSING'));

  const profileMismatch = decisions(permissionInput({
    posture: 'MARGIN_NEW_EXPOSURE',
    readProfile: readProfile({ marginMode: 'CROSS_CLASSIC' }),
    executionProfile: executionProfile({
      permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableMargin: true }),
      marginMode: 'ISOLATED',
    }),
  }));
  assert.ok(profileMismatch.every((item) => item.reasonCodes.includes('MARGIN_MODE_PROFILE_MISMATCH')));

  for (const [mode, reason] of [
    ['UNKNOWN', 'MARGIN_MODE_UNKNOWN'],
    ['ISOLATED', 'ISOLATED_MARGIN_SYMBOL_IDENTITY_UNAVAILABLE'],
  ]) {
    const blocked = decisions(permissionInput({
      posture: 'MARGIN_NEW_EXPOSURE',
      readProfile: readProfile({ marginMode: mode }),
      executionProfile: executionProfile({
        permissions: permissionPayload({ enableSpotAndMarginTrading: true, enableMargin: true }),
        marginMode: mode,
      }),
    }));
    assert.ok(blocked.every((item) => item.reasonCodes.includes(reason)));
  }
});

test('malformed, inherited, accessor, proxy, and secret-shaped permission inputs reject before review', () => {
  assert.throws(() => decisions({ ...permissionInput(), matrixSha256: 'wrong-revision' }), /matrix SHA/i);
  assert.throws(() => decisions({ ...permissionInput(), extra: true }), /exact fields/i);
  assert.throws(() => decisions(permissionInput({
    readProfile: readProfile({ permissions: { ...permissionPayload({ enableReading: true }), ipRestrict: 'true' } }),
  })), /must be boolean/i);
  assert.throws(() => decisions(permissionInput({ readProfile: { ...readProfile(), environment: 'DEMO' } })), /environment/i);

  const inherited = Object.create(permissionInput());
  assert.throws(() => decisions(inherited), /plain objects/i);

  let getterCalls = 0;
  const accessor = permissionInput();
  Object.defineProperty(accessor, 'posture', {
    enumerable: true,
    get() { getterCalls += 1; return 'SPOT_NEW_EXPOSURE'; },
  });
  assert.throws(() => decisions(accessor), /data properties/i);
  assert.equal(getterCalls, 0);

  let trapCalls = 0;
  const proxied = new Proxy(permissionInput(), {
    getOwnPropertyDescriptor(target, property) {
      trapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  assert.throws(() => decisions(proxied), /non-proxy/i);
  assert.equal(trapCalls, 0);

  assert.throws(() => decisions({
    ...permissionInput(),
    apiKey: 'fixture-sensitive-value',
  }), /secret-shaped field name/i);
});

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

const RATE = Object.freeze({ maker: '0.001', taker: '0.001', buyer: '0', seller: '0' });

function spotFactValue(kind, profileId) {
  switch (kind) {
    case 'SPOT_PERMISSIONS': {
      const decision = decisions().find((item) => item.profileId === profileId);
      return { ...decision.permissions, createTime: T0 - 10_000 };
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
        updateTime: T0 - 100,
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
      return { data: 'Normal' };
    case 'SPOT_TRADING_STATUS':
      return {
        data: {
          isLocked: false,
          plannedRecoverTime: null,
          triggerCondition: { GCR: 0, IFER: 0, UFR: 0 },
          updateTime: T0 - 100,
        },
      };
    default:
      throw new Error(`missing Spot fixture for ${kind}`);
  }
}

function normalizedSpotFact(
  kind,
  index,
  profileId = 'read-profile-1',
  injectedValue = spotFactValue(kind, profileId),
) {
  const contractId = SPOT_CONTRACT_IDS[kind];
  const contract = resolvePrivateFactContract(kind, L05_BINANCE_MATRIX_SHA256, contractId).contract;
  const query = kind === 'SPOT_OPEN_ORDERS'
    ? { queryScope: 'ALL_SYMBOLS', querySymbol: null }
    : ['SPOT_TRADES', 'SPOT_COMMISSIONS'].includes(kind)
      ? { queryScope: 'SYMBOL', querySymbol: 'BTCUSDT' }
      : { queryScope: 'ACCOUNT_WIDE', querySymbol: null };
  return normalizePrivateFactEvidence({
    schema: FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: 'SPOT',
    environment: 'PRODUCTION',
    realm: contract.realm,
    accountRealmId: ACCOUNT_REALM,
    profileId,
    contractId,
    ...query,
    queryAsset: null,
    queryType: null,
    marginMode: null,
    queryCoverage: spotQueryCoverage(kind),
    sourceId: contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: `private-receipt:${index.toString(16).padStart(24, '0')}`,
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: T0 - 100,
    receivedAtMs: T0 - 50,
    maxAgeMs: 1_000,
    value: injectedValue,
  }, T0);
}

function spotFacts(omitKind = null, nonPermissionProfileId = 'read-profile-1') {
  const facts = [];
  let index = 1;
  for (const kind of SPOT_FACTS) {
    if (kind === omitKind) continue;
    if (kind === 'SPOT_PERMISSIONS') {
      facts.push(normalizedSpotFact(kind, index, 'read-profile-1'));
      index += 1;
      facts.push(normalizedSpotFact(kind, index, 'execution-profile-1'));
    } else {
      facts.push(normalizedSpotFact(kind, index, nonPermissionProfileId));
    }
    index += 1;
  }
  return facts;
}

function spotFactsWithAccount(overrides) {
  return [
    ...spotFacts().filter((fact) => fact.factKind !== 'SPOT_ACCOUNT'),
    normalizedSpotFact(
      'SPOT_ACCOUNT',
      100,
      'read-profile-1',
      { ...spotFactValue('SPOT_ACCOUNT'), ...overrides },
    ),
  ];
}

function projection({
  omitKind = null,
  facts = spotFacts(omitKind),
  sourceCutRevision = null,
  resultRevision = FOUNDATION_RESULT_REVISION,
} = {}) {
  const permissionDecisions = decisions();
  const cutInput = {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM,
    targetSymbol: 'BTCUSDT',
    evaluatedAtMs: T0,
    facts,
    permissions: permissionDecisions,
  };
  const derivedSourceCutRevision = derivePrivateTruthSourceCutRevision(cutInput);
  const tradeFact = facts.find((fact) => fact.factKind === 'SPOT_TRADES');
  const historyCoverageRequirements = tradeFact === undefined ? [] : [{
    owner: 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE',
    status: 'EXACT_REQUIREMENT',
    requirementRevision: `foundation-history-coverage-requirement:${'1'.padStart(24, '0')}`,
    accountRealmId: ACCOUNT_REALM,
    posture: 'SPOT_NEW_EXPOSURE',
    targetSymbol: 'BTCUSDT',
    factKind: 'SPOT_TRADES',
    factEvidenceRevision: tradeFact.evidenceRevision,
    sourceCutRevision: derivedSourceCutRevision,
    startTimeMs: tradeFact.queryCoverage.startTimeMs,
    endTimeMs: tradeFact.queryCoverage.endTimeMs,
    executionAuthority: 'NONE',
  }];
  return projectPrivateTruth({
    ...cutInput,
    historyCoverageRequirements,
    reconciliationObservation: {
      owner: 'FOUNDATION_RECONCILIATION',
      status: 'EXACT',
      resultRevision,
      sourceCutRevision: sourceCutRevision ?? derivedSourceCutRevision,
      productCutRevisions: {
        SPOT: 'spot_rest_00000000000000000000000000000001',
        USD_M_PERPETUAL: null,
        MARGIN: null,
      },
      observedAtMs: T0,
      executionAuthority: 'NONE',
    },
  });
}

function handoffInput(overrides = {}) {
  return {
    projection: projection({ omitKind: 'SPOT_COMMISSIONS' }),
    mismatchCandidates: ['REST_LAGS_STREAM'],
    foreignEvidenceReferences: [FOREIGN_ORDER_REFERENCE],
    ...overrides,
  };
}

test('Spot account trade, account-type, and account-permission posture block completeness', () => {
  const cases = [
    [{ canTrade: false }, 'SPOT_ACCOUNT_TRADE_DISABLED'],
    [{ accountType: 'MARGIN' }, 'SPOT_ACCOUNT_TYPE_UNSUPPORTED'],
    [{ permissions: [] }, 'SPOT_ACCOUNT_PERMISSION_MISSING'],
  ];
  for (const [overrides, reason] of cases) {
    const result = projection({ facts: spotFactsWithAccount(overrides) });
    assert.equal(result.entryEvidenceComplete, false, reason);
    assert.equal(result.completeness, 'PARTIAL', reason);
    assert.equal(result.spot.completeness, 'PARTIAL', reason);
    assert.ok(result.reasonCodes.includes(reason), JSON.stringify(result.reasonCodes));
    assertNoAuthority(result);
  }
});

test('every current non-permission fact is bound to the exact READ_KEY profile', () => {
  const result = projection({ facts: spotFacts(null, 'profile.unrelated.1') });
  assert.equal(result.entryEvidenceComplete, false);
  assert.equal(result.spot.completeness, 'PARTIAL');
  for (const kind of SPOT_FACTS.filter((kind) => kind !== 'SPOT_PERMISSIONS')) {
    assert.ok(
      result.reasonCodes.includes(`FACT_READ_PROFILE_MISMATCH_${kind}`),
      `${kind}: ${result.reasonCodes.join(',')}`,
    );
  }
  assertNoAuthority(result);
});

test('Foundation reconciliation observation must bind the exact derived private source cut', () => {
  const sourceFacts = spotFacts();
  const permissionDecisions = decisions();
  const sourceCutInput = {
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM,
    targetSymbol: 'BTCUSDT',
    evaluatedAtMs: T0,
    facts: sourceFacts,
    permissions: permissionDecisions,
  };
  const firstCut = derivePrivateTruthSourceCutRevision(sourceCutInput);
  const reorderedCut = derivePrivateTruthSourceCutRevision({
    ...sourceCutInput,
    facts: [...sourceFacts].reverse(),
    permissions: [...permissionDecisions].reverse(),
  });
  assert.equal(reorderedCut, firstCut);
  assert.match(firstCut, /^l05pcut_[0-9a-f]{64}$/);
  assert.notEqual(
    derivePrivateTruthSourceCutRevision({
      ...sourceCutInput,
      facts: spotFactsWithAccount({ canTrade: false }),
    }),
    firstCut,
  );

  const mismatched = projection({ sourceCutRevision: `l05pcut_${'f'.repeat(64)}` });
  assert.equal(mismatched.entryEvidenceComplete, false);
  assert.equal(mismatched.completeness, 'PARTIAL');
  assert.ok(mismatched.reasonCodes.includes('FOUNDATION_RECONCILIATION_SOURCE_CUT_MISMATCH'));
  assertNoAuthority(mismatched);

  const exact = projection();
  assert.equal(exact.entryEvidenceComplete, true);
  assert.match(exact.reconciliationObservation.sourceCutRevision, /^l05pcut_[0-9a-f]{64}$/);
  assert.equal(exact.reasonCodes.includes('FOUNDATION_RECONCILIATION_SOURCE_CUT_MISMATCH'), false);
});

test('handoff emits frozen comparison evidence without owner verdict or authority', () => {
  const input = handoffInput();
  const handoff = createPrivateComparisonHandoff(input);
  assert.equal(handoff.schema, L05_PRIVATE_HANDOFF_SCHEMA);
  assert.equal(handoff.accountRealmId, ACCOUNT_REALM);
  assert.equal(handoff.projectionRevision, input.projection.projectionRevision);
  assert.deepEqual(handoff.sourceCutRevisions, [
    ...input.projection.sourceFacts.map((fact) => fact.evidenceRevision),
    input.projection.reconciliationObservation.sourceCutRevision,
  ].sort());
  assert.deepEqual(handoff.mismatchCandidates, [
    'FACT_MISSING_SPOT_COMMISSIONS',
    'PRIVATE_PROJECTION_NOT_COMPLETE',
    'REST_LAGS_STREAM',
  ]);
  assert.deepEqual(handoff.foreignEvidenceReferences, [FOREIGN_ORDER_REFERENCE]);
  assert.equal(handoff.canonicalStatus, null);
  assert.equal(handoff.recommendation, null);
  assert.equal(handoff.canClearAmbiguity, false);
  assert.match(handoff.handoffRevision, /^l05hand_[0-9a-f]{64}$/);
  assertNoAuthority(handoff);
  assertDeeplyFrozen(handoff);
});

test('handoff is deterministic, order-independent, detached, and preserves foreign evidence', () => {
  const firstInput = handoffInput({
    mismatchCandidates: ['Z_MISMATCH', 'A_MISMATCH', 'A_MISMATCH'],
    foreignEvidenceReferences: [FOREIGN_POSITION_REFERENCE, FOREIGN_ORDER_REFERENCE],
  });
  const first = createPrivateComparisonHandoff(firstInput);
  const second = createPrivateComparisonHandoff(handoffInput({
    mismatchCandidates: ['A_MISMATCH', 'Z_MISMATCH'],
    foreignEvidenceReferences: [FOREIGN_ORDER_REFERENCE, FOREIGN_POSITION_REFERENCE],
  }));
  assert.deepEqual(first, second);
  firstInput.mismatchCandidates.push('LATE_MUTATION');
  firstInput.foreignEvidenceReferences.length = 0;
  assert.deepEqual(first, second);
});

test('a complete projection still yields evidence-only handoff and no ambiguity-clearing claim', () => {
  const complete = projection();
  const result = createPrivateComparisonHandoff({
    projection: complete,
    mismatchCandidates: [],
    foreignEvidenceReferences: [],
  });
  assert.deepEqual(result.mismatchCandidates, []);
  assert.equal(result.canonicalStatus, null);
  assert.equal(result.canClearAmbiguity, false);
  assertNoAuthority(result);
});

test('handoff closes reconciliation, mismatch, and foreign-reference namespaces', () => {
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    projection: projection({ resultRevision: 'foundation-result-opaque' }),
  })), /result revision namespace mismatch|exact closed namespaces/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    projection: projection({ sourceCutRevision: 'foundation-source-cut-opaque' }),
  })), /source cut revision namespace mismatch|exact closed namespaces/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    mismatchCandidates: ['MISMATCH'],
  })), /uppercase mismatch reason/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    mismatchCandidates: ['A'.repeat(64)],
  })), /secret-shaped text/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    foreignEvidenceReferences: ['foreign-order:BTCUSDT:7'],
  })), /closed foreign evidence reference/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    foreignEvidenceReferences: [`foreign-order:${'A'.repeat(24)}`],
  })), /closed foreign evidence reference/i);
});

test('handoff refuses forged projection summaries, permission stubs and source witnesses', () => {
  const authentic = projection();
  const forged = [];

  const summary = structuredClone(authentic);
  summary.reasonCodes.push('FORGED_OWNER_CLEARANCE');
  forged.push(summary);

  const permission = structuredClone(authentic);
  permission.permissions[0] = { revision: authentic.permissions[0].revision };
  forged.push(permission);

  const witness = structuredClone(authentic);
  witness.sourceFacts[0].usableAsPrivateEvidence = !witness.sourceFacts[0].usableAsPrivateEvidence;
  forged.push(witness);

  const cut = structuredClone(authentic);
  cut.reconciliationObservation.sourceCutRevision = 'forged-foundation-cut';
  forged.push(cut);

  const productCut = structuredClone(authentic);
  productCut.reconciliationObservation.productCutRevisions.SPOT =
    'spot_rest_00000000000000000000000000000002';
  forged.push(productCut);

  const siblingProductCut = structuredClone(authentic);
  siblingProductCut.reconciliationObservation.productCutRevisions.USD_M_PERPETUAL =
    'usdm_rest_00000000000000000000000000000001';
  forged.push(siblingProductCut);

  for (const candidate of forged) {
    assert.throws(() => createPrivateComparisonHandoff({
      projection: candidate,
      mismatchCandidates: [],
      foreignEvidenceReferences: [],
    }));
  }
});

test('handoff rejects authority escalation, malformed shapes, resource overflow, aliases, and hostile objects', () => {
  const escalated = structuredClone(projection());
  escalated.capitalAuthority = 'OWNER';
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    projection: escalated,
  })), /contract mismatch/i);
  assert.throws(() => createPrivateComparisonHandoff({ ...handoffInput(), extra: true }), /exact fields/i);
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    mismatchCandidates: Array.from({ length: 257 }, (_, index) => `MISMATCH_${index}`),
  })), /bounded array/i);

  const shared = ['shared-reference-1'];
  assert.throws(() => createPrivateComparisonHandoff(handoffInput({
    mismatchCandidates: shared,
    foreignEvidenceReferences: shared,
  })), /cycles and aliases/i);

  let getterCalls = 0;
  const accessor = handoffInput();
  Object.defineProperty(accessor, 'projection', {
    enumerable: true,
    get() { getterCalls += 1; return projection(); },
  });
  assert.throws(() => createPrivateComparisonHandoff(accessor), /data properties/i);
  assert.equal(getterCalls, 0);

  let trapCalls = 0;
  const proxied = new Proxy(handoffInput(), {
    ownKeys(target) {
      trapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => createPrivateComparisonHandoff(proxied), /non-proxy/i);
  assert.equal(trapCalls, 0);

  assert.throws(() => createPrivateComparisonHandoff({
    ...handoffInput(),
    signature: 'fixture-sensitive-value',
  }), /secret-shaped field name/i);
});
