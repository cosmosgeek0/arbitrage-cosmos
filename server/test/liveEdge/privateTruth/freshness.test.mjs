import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L05_BINANCE_MATRIX_SHA256,
  L05_PRIVATE_FACT_SCHEMA,
  L05_PRIVATE_FACT_SCHEMA_REVISIONS,
  L05_PRIVATE_GAP_SOURCE_ID,
  L05_PRIVATE_FUTURE_SKEW_MS,
  PRIVATE_FACT_CONTRACT_POLICY,
  PRIVATE_FACT_KINDS,
  evaluatePrivateFactFreshness,
  evaluatePrivatePermissions,
  normalizePrivateFactEvidence,
  projectPrivateTruth,
  resolvePrivateFactContract,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/index.js';

const T0 = 1_800_000_000_000;
const MAX_AGE_MS = 1_000;
const ACCOUNT_REALM_ID = 'account.prod.1';
const ACCOUNT_FINGERPRINT_REF = 'account.fingerprint.1';

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
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

function freshnessInput(overrides = {}) {
  return {
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'SPOT_ACCOUNT_CATALOG_2026_07_12',
    sourceTimeMs: T0,
    receivedAtMs: T0,
    maxAgeMs: MAX_AGE_MS,
    receiptTimeFallbackAllowed: false,
    ...overrides,
  };
}

function gapRealm(kind) {
  return PRIVATE_FACT_CONTRACT_POLICY[kind].product === 'MARGIN'
    ? 'PRIVATE_MARGIN_ACCOUNT'
    : 'PRIVATE_ACCOUNT';
}

function queryMetadata(kind, isGap) {
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

function queryCoverage(kind, isGap) {
  if (isGap) return { kind: 'UNAVAILABLE_GAP', ...NULL_QUERY_COVERAGE };
  if (kind === 'SPOT_ACCOUNT') {
    return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE, omitZeroBalances: false };
  }
  if (['SPOT_TRADES', 'USDM_TRADES', 'MARGIN_TRADES'].includes(kind)) {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: T0 - 60_000,
      endTimeMs: T0,
      limit: 1_000,
    };
  }
  if (kind === 'MARGIN_INTEREST') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: T0 - 60_000,
      endTimeMs: T0,
      page: 1,
      size: 100,
    };
  }
  if (kind === 'MARGIN_INTEREST_RATE') {
    return {
      kind: 'HISTORY_EXPLICIT_WINDOW',
      ...NULL_QUERY_COVERAGE,
      startTimeMs: T0 - 60_000,
      endTimeMs: T0,
    };
  }
  return { kind: 'CURRENT_UNFILTERED', ...NULL_QUERY_COVERAGE };
}

function unavailableFactInput(kind, overrides = {}) {
  const policy = PRIVATE_FACT_CONTRACT_POLICY[kind];
  assert.ok(policy, `missing contract policy for ${kind}`);
  const resolution = resolvePrivateFactContract(
    kind,
    L05_BINANCE_MATRIX_SHA256,
    policy.contractId,
  );
  const isGap = resolution.contract === null;
  return {
    schema: L05_PRIVATE_FACT_SCHEMA,
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    factKind: kind,
    product: policy.product,
    environment: 'PRODUCTION',
    realm: isGap ? gapRealm(kind) : resolution.contract.realm,
    accountRealmId: ACCOUNT_REALM_ID,
    profileId: isGap ? null : 'profile.read.1',
    contractId: policy.contractId,
    ...queryMetadata(kind, isGap),
    queryCoverage: queryCoverage(kind, isGap),
    sourceId: isGap ? L05_PRIVATE_GAP_SOURCE_ID : resolution.contract.sourceIds[0],
    schemaRevision: L05_PRIVATE_FACT_SCHEMA_REVISIONS[kind],
    receiptId: `private-receipt:${PRIVATE_FACT_KINDS.indexOf(kind).toString(16).padStart(24, '0')}`,
    readState: 'UNAVAILABLE',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimeMs: null,
    receivedAtMs: T0,
    maxAgeMs: MAX_AGE_MS,
    value: null,
    ...overrides,
  };
}

function currentStatusFactInput(kind, overrides = {}) {
  const unavailable = unavailableFactInput(kind);
  assert.notEqual(unavailable.contractId, null);
  return {
    ...unavailable,
    profileId: 'profile.read.1',
    readState: 'OK',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: T0,
    value: { data: 'Normal' },
    ...overrides,
  };
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

function profile(profileClass, permissions, overrides = {}) {
  return {
    profileClass,
    profileId: profileClass === 'READ_KEY' ? 'profile.read.1' : 'profile.execution.1',
    accountRealmId: ACCOUNT_REALM_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT_REF,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions,
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: false,
    usdmMultiAssetsMargin: false,
    marginMode: 'CROSS_CLASSIC',
    ...overrides,
  };
}

function permissionDecisions(posture) {
  const needsSpot = posture === 'SPOT_NEW_EXPOSURE'
    || posture === 'SPOT_USDM_NEW_EXPOSURE'
    || posture === 'MARGIN_NEW_EXPOSURE';
  const needsFutures = posture === 'USDM_NEW_EXPOSURE'
    || posture === 'SPOT_USDM_NEW_EXPOSURE';
  const needsMargin = posture === 'MARGIN_NEW_EXPOSURE';
  const decisions = evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId: ACCOUNT_REALM_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT_REF,
    readProfile: profile('READ_KEY', permissionPayload({ enableReading: true })),
    executionProfile: profile('EXECUTION_KEY', permissionPayload({
      enableSpotAndMarginTrading: needsSpot,
      enableFutures: needsFutures,
      enableMargin: needsMargin,
    })),
  });
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((decision) => decision.acceptableForOwnerReview),
    JSON.stringify(decisions.map((decision) => decision.reasonCodes)));
  return decisions;
}

function projection(posture, facts) {
  return projectPrivateTruth({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture,
    accountRealmId: ACCOUNT_REALM_ID,
    targetSymbol: 'BTCUSDT',
    evaluatedAtMs: T0,
    facts,
    permissions: permissionDecisions(posture),
    reconciliationObservation: null,
  });
}

test('freshness is exact below, at, and above every fact-kind expiry boundary', async (t) => {
  assert.equal(PRIVATE_FACT_KINDS.length, 35);
  for (const kind of PRIVATE_FACT_KINDS) {
    await t.test(kind, () => {
      const below = evaluatePrivateFactFreshness(freshnessInput(), T0 + MAX_AGE_MS - 1);
      const at = evaluatePrivateFactFreshness(freshnessInput(), T0 + MAX_AGE_MS);
      const above = evaluatePrivateFactFreshness(freshnessInput(), T0 + MAX_AGE_MS + 1);
      assert.equal(below.freshness.state, 'FRESH');
      assert.equal(at.freshness.state, 'FRESH');
      assert.equal(at.validUntilMs, T0 + MAX_AGE_MS);
      assert.equal(at.usableAsPrivateEvidence, true);
      assert.equal(above.freshness.state, 'STALE');
      assert.equal(above.freshness.effectiveAuthority, 'UNAVAILABLE');
      assert.equal(above.usableAsPrivateEvidence, false);
      assert.ok(above.reasonCodes.includes('PRIVATE_SOURCE_STALE'));
    });
  }
});

test('future-skew boundary is fresh at tolerance and blocking one millisecond beyond', () => {
  assert.equal(L05_PRIVATE_FUTURE_SKEW_MS, 2_000);
  const at = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS,
  }), T0);
  assert.equal(at.freshness.state, 'FRESH');
  assert.equal(at.freshness.ageMs, -L05_PRIVATE_FUTURE_SKEW_MS);
  assert.equal(at.usableAsPrivateEvidence, true);

  const above = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1,
  }), T0);
  assert.equal(above.freshness.state, 'CLOCK_SKEWED');
  assert.equal(above.freshness.effectiveAuthority, 'UNAVAILABLE');
  assert.equal(above.usableAsPrivateEvidence, false);
  assert.ok(above.reasonCodes.includes('PRIVATE_SOURCE_CLOCK_SKEWED'));
});

test('a private fact is unavailable before its receipt cut, with no clock-skew grace period', () => {
  const below = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 - 1,
    receivedAtMs: T0 - 1,
  }), T0);
  assert.equal(below.freshness.basis, 'SOURCE_TIME');
  assert.equal(below.usableAsPrivateEvidence, true);
  assert.equal(below.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_EVALUATION'), false);

  const at = evaluatePrivateFactFreshness(freshnessInput(), T0);
  assert.equal(at.usableAsPrivateEvidence, true);
  assert.equal(at.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_EVALUATION'), false);

  const above = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + 1,
    receivedAtMs: T0 + 1,
  }), T0);
  assert.equal(above.freshness.state, 'FRESH');
  assert.equal(above.freshness.basis, 'SOURCE_TIME');
  assert.equal(above.usableAsPrivateEvidence, false);
  assert.ok(above.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_EVALUATION'));
});

test('source and receipt causal separation is exact in both directions while source owns age', () => {
  const receiptAfterSourceBelow = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0,
    receivedAtMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS - 1,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);
  const receiptAfterSourceAt = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0,
    receivedAtMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);
  const receiptAfterSourceAbove = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0,
    receivedAtMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);

  for (const result of [receiptAfterSourceBelow, receiptAfterSourceAt, receiptAfterSourceAbove]) {
    assert.equal(result.freshness.basis, 'SOURCE_TIME');
    assert.equal(result.freshness.ageMs, L05_PRIVATE_FUTURE_SKEW_MS + 1);
  }
  assert.equal(receiptAfterSourceBelow.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_SOURCE_CLOCK_SKEWED'), false);
  assert.equal(receiptAfterSourceAt.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_SOURCE_CLOCK_SKEWED'), false);
  assert.equal(receiptAfterSourceBelow.usableAsPrivateEvidence, true);
  assert.equal(receiptAfterSourceAt.usableAsPrivateEvidence, true);
  assert.ok(receiptAfterSourceAbove.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_SOURCE_CLOCK_SKEWED'));
  assert.equal(receiptAfterSourceAbove.usableAsPrivateEvidence, false);

  const sourceAfterReceiptBelow = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS - 1,
    receivedAtMs: T0,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);
  const sourceAfterReceiptAt = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS,
    receivedAtMs: T0,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);
  const sourceAfterReceiptAbove = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1,
    receivedAtMs: T0,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1);

  assert.equal(sourceAfterReceiptBelow.freshness.basis, 'SOURCE_TIME');
  assert.equal(sourceAfterReceiptBelow.freshness.ageMs, 2);
  assert.equal(sourceAfterReceiptAt.freshness.ageMs, 1);
  assert.equal(sourceAfterReceiptAbove.freshness.ageMs, 0);
  assert.equal(sourceAfterReceiptBelow.reasonCodes.includes('PRIVATE_SOURCE_AFTER_RECEIPT_CLOCK_SKEWED'), false);
  assert.equal(sourceAfterReceiptAt.reasonCodes.includes('PRIVATE_SOURCE_AFTER_RECEIPT_CLOCK_SKEWED'), false);
  assert.equal(sourceAfterReceiptBelow.usableAsPrivateEvidence, true);
  assert.equal(sourceAfterReceiptAt.usableAsPrivateEvidence, true);
  assert.ok(sourceAfterReceiptAbove.reasonCodes.includes('PRIVATE_SOURCE_AFTER_RECEIPT_CLOCK_SKEWED'));
  assert.equal(sourceAfterReceiptAbove.usableAsPrivateEvidence, false);
});

test('the fixed causal tolerance cannot be widened by an extra JavaScript argument', () => {
  const widenedAttempt = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0,
    receivedAtMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1,
    maxAgeMs: 10_000,
  }), T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1, 60_000);

  assert.equal(widenedAttempt.freshness.state, 'FRESH');
  assert.ok(widenedAttempt.reasonCodes.includes('PRIVATE_RECEIPT_AFTER_SOURCE_CLOCK_SKEWED'));
  assert.equal(widenedAttempt.usableAsPrivateEvidence, false);
});

test('direct freshness admits only selected private documentary sources and blocks the gap marker', () => {
  const selectedSourceIds = new Set();
  for (const policy of Object.values(PRIVATE_FACT_CONTRACT_POLICY)) {
    if (policy.contractId === null) continue;
    const contract = resolvePrivateFactContract(
      policy.factKind,
      L05_BINANCE_MATRIX_SHA256,
      policy.contractId,
    ).contract;
    for (const sourceId of contract.sourceIds) selectedSourceIds.add(sourceId);
  }
  for (const sourceId of selectedSourceIds) {
    assert.doesNotThrow(() => evaluatePrivateFactFreshness(freshnessInput({ sourceId }), T0));
  }

  const gap = evaluatePrivateFactFreshness(freshnessInput({
    sourceId: L05_PRIVATE_GAP_SOURCE_ID,
  }), T0);
  assert.equal(gap.usableAsPrivateEvidence, false);
  assert.ok(gap.reasonCodes.includes('PRIVATE_CONTRACT_GAP'));
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({
    sourceId: 'SPOT_DEMO_GIT_31643ED',
  }), T0), /exact selected L05 documentary source/i);
});

test('source time remains authoritative over a newer receipt time', () => {
  const result = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: T0 - MAX_AGE_MS - 1,
    receivedAtMs: T0,
  }), T0);
  assert.equal(result.freshness.basis, 'SOURCE_TIME');
  assert.equal(result.freshness.ageMs, MAX_AGE_MS + 1);
  assert.equal(result.freshness.state, 'STALE');
  assert.equal(result.usableAsPrivateEvidence, false);
});

test('missing source time blocks unless the exact caller policy permits receipt fallback', () => {
  const blocked = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: null,
  }), T0);
  assert.equal(blocked.freshness.state, 'UNAVAILABLE');
  assert.equal(blocked.freshness.basis, 'NONE');
  assert.equal(blocked.validUntilMs, null);
  assert.equal(blocked.usableAsPrivateEvidence, false);
  assert.ok(blocked.reasonCodes.includes('PRIVATE_SOURCE_TIME_REQUIRED'));

  const fallback = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: null,
    receiptTimeFallbackAllowed: true,
  }), T0 + MAX_AGE_MS);
  assert.equal(fallback.freshness.state, 'FRESH');
  assert.equal(fallback.freshness.basis, 'RECEIPT_TIME');
  assert.equal(fallback.validUntilMs, T0 + MAX_AGE_MS);
  assert.equal(fallback.usableAsPrivateEvidence, true);
  assert.deepEqual(fallback.reasonCodes, ['PRIVATE_RECEIPT_TIME_FALLBACK']);
});

test('receipt fallback observes the exact local receipt cut below, at, and above evaluation', () => {
  const below = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: null,
    receivedAtMs: T0 - 1,
    receiptTimeFallbackAllowed: true,
  }), T0);
  const at = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: null,
    receiptTimeFallbackAllowed: true,
  }), T0);
  const above = evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: null,
    receivedAtMs: T0 + 1,
    receiptTimeFallbackAllowed: true,
  }), T0);

  assert.equal(below.freshness.basis, 'RECEIPT_TIME');
  assert.equal(below.freshness.ageMs, 1);
  assert.equal(below.usableAsPrivateEvidence, true);
  assert.deepEqual(below.reasonCodes, ['PRIVATE_RECEIPT_TIME_FALLBACK']);
  assert.equal(at.freshness.ageMs, 0);
  assert.equal(at.usableAsPrivateEvidence, true);
  assert.deepEqual(at.reasonCodes, ['PRIVATE_RECEIPT_TIME_FALLBACK']);
  assert.equal(above.freshness.state, 'FRESH');
  assert.equal(above.freshness.ageMs, -1);
  assert.equal(above.usableAsPrivateEvidence, false);
  assert.deepEqual(above.reasonCodes, [
    'PRIVATE_RECEIPT_AFTER_EVALUATION',
    'PRIVATE_RECEIPT_TIME_FALLBACK',
  ]);
});

test('failed reads, unavailable truth, partial truth, and non-private authority never become usable', () => {
  const cases = [
    ['RATE_LIMITED', freshnessInput({ readState: 'RATE_LIMITED' }), 'PRIVATE_SOURCE_RATE_LIMITED'],
    ['SOURCE_ERROR', freshnessInput({ readState: 'SOURCE_ERROR' }), 'PRIVATE_SOURCE_ERROR'],
    ['UNAVAILABLE_READ', freshnessInput({
      readState: 'UNAVAILABLE', authority: 'UNAVAILABLE', completeness: 'UNAVAILABLE',
    }), 'PRIVATE_SOURCE_UNAVAILABLE'],
    ['PARTIAL', freshnessInput({ completeness: 'PARTIAL' }), 'PRIVATE_SOURCE_PARTIAL'],
    ['LIVE_PUBLIC', freshnessInput({ authority: 'LIVE_PUBLIC' }), 'PRIVATE_AUTHORITY_REQUIRED'],
    ['DERIVED_LIVE', freshnessInput({ authority: 'DERIVED_LIVE' }), 'PRIVATE_AUTHORITY_REQUIRED'],
  ];
  for (const [label, input, reason] of cases) {
    const result = evaluatePrivateFactFreshness(input, T0);
    assert.equal(result.usableAsPrivateEvidence, false, label);
    assert.ok(result.reasonCodes.includes(reason), `${label}: ${result.reasonCodes.join(',')}`);
  }
});

test('every fact kind preserves explicit unavailable truth independently', () => {
  const normalized = PRIVATE_FACT_KINDS.map((kind) => (
    normalizePrivateFactEvidence(unavailableFactInput(kind), T0)
  ));
  assert.equal(normalized.length, PRIVATE_FACT_KINDS.length);
  for (const [index, fact] of normalized.entries()) {
    const kind = PRIVATE_FACT_KINDS[index];
    assert.equal(fact.factKind, kind);
    assert.equal(fact.product, PRIVATE_FACT_CONTRACT_POLICY[kind].product);
    assert.equal(fact.readState, 'UNAVAILABLE');
    assert.equal(fact.authority, 'UNAVAILABLE');
    assert.equal(fact.completeness, 'UNAVAILABLE');
    assert.equal(fact.injectedValue, null);
    assert.equal(fact.value, null);
    assert.equal(fact.freshness.state, 'UNAVAILABLE');
    assert.equal(fact.validUntilMs, null);
    assert.equal(fact.usableAsPrivateEvidence, false);
    assert.ok(fact.reasonCodes.includes('PRIVATE_SOURCE_UNAVAILABLE'));
    assertNoAuthority(fact);
    assertDeeplyFrozen(fact);
  }
});

test('official gaps remain explicit and cannot acquire a candidate contract or value', () => {
  for (const kind of [
    'USDM_COMMISSIONS',
    'USDM_INCOME',
    'USDM_ADL',
    'USDM_ALGO_OPEN_ORDERS',
    'USDM_ACCOUNT_CONFIGURATION',
    'USDM_SYMBOL_CONFIGURATION',
    'MARGIN_MAX_BORROWABLE',
    'MARGIN_BORROW_REPAY_HISTORY',
  ]) {
    const input = unavailableFactInput(kind);
    const fact = normalizePrivateFactEvidence(input, T0);
    assert.equal(fact.contractId, null);
    assert.equal(fact.sourceId, L05_PRIVATE_GAP_SOURCE_ID);
    assert.ok(fact.reasonCodes.includes(PRIVATE_FACT_CONTRACT_POLICY[kind].gapReason));
    assert.equal(fact.usableAsPrivateEvidence, false);
    assert.throws(() => normalizePrivateFactEvidence({
      ...input,
      contractId: 'SPOT_ACCOUNT_BALANCES',
    }, T0), TypeError);
    assert.throws(() => normalizePrivateFactEvidence({
      ...input,
      readState: 'OK',
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceTimeMs: T0,
      value: {},
    }, T0), TypeError);
  }
});

test('normalized fact expiry and future skew remain named, blocking evidence', () => {
  const expired = normalizePrivateFactEvidence(currentStatusFactInput('SPOT_ACCOUNT_STATUS'), T0 + MAX_AGE_MS + 1);
  assert.equal(expired.freshness.state, 'STALE');
  assert.equal(expired.validUntilMs, T0 + MAX_AGE_MS);
  assert.equal(expired.usableAsPrivateEvidence, false);
  assert.ok(expired.reasonCodes.includes('PRIVATE_SOURCE_STALE'));

  const future = normalizePrivateFactEvidence(currentStatusFactInput('SPOT_ACCOUNT_STATUS', {
    sourceTimeMs: T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1,
  }), T0);
  assert.equal(future.freshness.state, 'CLOCK_SKEWED');
  assert.equal(
    future.validUntilMs,
    T0 + L05_PRIVATE_FUTURE_SKEW_MS + 1 + MAX_AGE_MS,
  );
  assert.equal(future.usableAsPrivateEvidence, false);
  assert.ok(future.reasonCodes.includes('PRIVATE_SOURCE_CLOCK_SKEWED'));
  assertNoAuthority(expired);
  assertNoAuthority(future);
});

test('EXECUTION_KEY read permission is an unsupported combined-profile posture', () => {
  const decisions = evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT_REF,
    readProfile: profile('READ_KEY', permissionPayload({ enableReading: true })),
    executionProfile: profile('EXECUTION_KEY', permissionPayload({
      enableReading: true,
      enableSpotAndMarginTrading: true,
    })),
  });
  const execution = decisions.find((decision) => decision.profileClass === 'EXECUTION_KEY');
  assert.ok(execution);
  assert.equal(execution.acceptableForOwnerReview, false);
  assert.ok(execution.reasonCodes.includes('EXECUTION_PROFILE_HAS_READ_PERMISSION'));
  assert.ok(execution.reasonCodes.includes('COMBINED_PROFILE_OWNER_EXCEPTION_REQUIRED'));
  assertNoAuthority(execution);
});

test('generic credential-shaped references are rejected before retention', () => {
  const generic64 = 'A'.repeat(64);
  assert.throws(() => normalizePrivateFactEvidence({
    ...currentStatusFactInput('SPOT_ACCOUNT_STATUS'),
    accountRealmId: generic64,
  }, T0), /secret-shaped text|namespaced account-realm reference/i);
  assert.throws(() => normalizePrivateFactEvidence({
    ...currentStatusFactInput('SPOT_ACCOUNT_STATUS'),
    profileId: generic64,
  }, T0), /secret-shaped text|namespaced profile reference/i);
  assert.throws(() => evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM_ID,
    accountFingerprintRef: generic64,
    readProfile: profile('READ_KEY', permissionPayload({ enableReading: true })),
    executionProfile: profile('EXECUTION_KEY', permissionPayload({ enableSpotAndMarginTrading: true })),
  }), /secret-shaped text|namespaced account-fingerprint reference/i);
});

test('semantic and evidence revisions are deterministic while schema identity stays closed', () => {
  const input = currentStatusFactInput('SPOT_ACCOUNT_STATUS');
  const first = normalizePrivateFactEvidence(input, T0);
  const repeat = normalizePrivateFactEvidence(structuredClone(input), T0);
  assert.deepEqual(repeat, first);

  const anotherReceipt = normalizePrivateFactEvidence({
    ...input,
    receiptId: `private-receipt:${'f'.repeat(24)}`,
  }, T0);
  assert.equal(anotherReceipt.contentRevision, first.contentRevision);
  assert.notEqual(anotherReceipt.evidenceRevision, first.evidenceRevision);

  assert.throws(() => normalizePrivateFactEvidence({
    ...input,
    schemaRevision: 'L05_BINANCE_PRIVATE_SPOT_ACCOUNT_STATUS_V2',
  }, T0), /schemaRevision/i);
});

test('contradictory product, contract, matrix, and unsupported fact revisions fail closed', () => {
  const input = currentStatusFactInput('SPOT_ACCOUNT_STATUS');
  assert.throws(() => normalizePrivateFactEvidence({
    ...input,
    product: 'USD_M_PERPETUAL',
  }, T0), TypeError);
  assert.throws(() => normalizePrivateFactEvidence({
    ...input,
    contractId: 'USDM_ACCOUNT_STATUS',
  }, T0), TypeError);
  assert.throws(() => normalizePrivateFactEvidence({
    ...input,
    matrixSha256: '0'.repeat(64),
  }, T0), TypeError);
  assert.throws(() => normalizePrivateFactEvidence({
    ...input,
    factKind: 'SPOT_UNKNOWN_REVISION',
  }, T0), TypeError);
});

test('fresh Spot, USD-M, or Margin status cannot promote a sibling product', () => {
  const cases = [
    ['SPOT_ACCOUNT_STATUS', 'SPOT_NEW_EXPOSURE', 'spot', ['futures', 'margin']],
    ['USDM_ACCOUNT_STATUS', 'USDM_NEW_EXPOSURE', 'futures', ['spot', 'margin']],
    ['MARGIN_ACCOUNT_STATUS', 'MARGIN_NEW_EXPOSURE', 'margin', ['spot', 'futures']],
  ];
  for (const [kind, posture, target, siblings] of cases) {
    const fact = normalizePrivateFactEvidence(currentStatusFactInput(kind), T0);
    assert.equal(fact.usableAsPrivateEvidence, true, kind);
    const result = projection(posture, [fact]);
    assert.equal(result[target].completeness, 'PARTIAL', kind);
    for (const sibling of siblings) {
      assert.equal(result[sibling].completeness, 'UNKNOWN', `${kind} promoted ${sibling}`);
      assert.deepEqual(result[sibling].factKinds, []);
    }
    assert.equal(result.entryEvidenceComplete, false);
    assert.equal(result.completeness, 'PARTIAL');
    assertNoAuthority(result);
    assertDeeplyFrozen(result);
  }
});

test('duplicate evidence revisions and mismatched evaluation cuts are rejected by projection', () => {
  const fact = normalizePrivateFactEvidence(currentStatusFactInput('SPOT_ACCOUNT_STATUS'), T0);
  assert.throws(() => projection('SPOT_NEW_EXPOSURE', [fact, fact]), TypeError);
  assert.throws(() => projectPrivateTruth({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_REALM_ID,
    targetSymbol: 'BTCUSDT',
    evaluatedAtMs: T0 + 1,
    facts: [fact],
    permissions: permissionDecisions('SPOT_NEW_EXPOSURE'),
    reconciliationObservation: null,
  }), TypeError);
});

test('freshness output is deterministic, immutable, and carries no action surface', () => {
  const input = freshnessInput();
  const first = evaluatePrivateFactFreshness(input, T0 + 5);
  const second = evaluatePrivateFactFreshness(structuredClone(input), T0 + 5);
  assert.deepEqual(second, first);
  assertDeeplyFrozen(first);
  assert.equal(Object.hasOwn(first, 'sendEligible'), false);
  assert.equal(Object.hasOwn(first, 'actionAuthority'), false);
  assert.equal(Object.hasOwn(first, 'accountReadAuthority'), false);
  assert.throws(() => { first.usableAsPrivateEvidence = false; }, TypeError);
  assert.throws(() => { first.reasonCodes.push('PROMOTE'); }, TypeError);
});

test('unknown fields, inherited values, accessors, proxies, arrays, and secret-shaped input fail closed', () => {
  assert.throws(() => evaluatePrivateFactFreshness({
    ...freshnessInput(),
    unknown: true,
  }, T0), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness(
    Object.assign(Object.create({ inherited: true }), freshnessInput()),
    T0,
  ), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness([], T0), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness({
    ...freshnessInput(),
    apiKey: 'forbidden',
  }, T0), TypeError);

  let accessed = false;
  const accessor = freshnessInput();
  Object.defineProperty(accessor, 'sourceTimeMs', {
    enumerable: true,
    get() {
      accessed = true;
      return T0;
    },
  });
  assert.throws(() => evaluatePrivateFactFreshness(accessor, T0), TypeError);
  assert.equal(accessed, false);

  let trapCalls = 0;
  const proxy = new Proxy(freshnessInput(), {
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not inspect proxy');
    },
  });
  assert.throws(() => evaluatePrivateFactFreshness(proxy, T0), TypeError);
  assert.equal(trapCalls, 0);
});

test('invalid clocks, policy bounds, source identities, and validity overflow are rejected', () => {
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput(), -1), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({ maxAgeMs: 0 }), T0), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({
    maxAgeMs: 300_001,
  }), T0), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({ sourceId: '' }), T0), TypeError);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({
    sourceId: 'UNBOUND_SYNTHETIC_SOURCE',
  }), T0), /exact selected L05 documentary source/i);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({
    sourceId: 'A'.repeat(64),
  }), T0), /secret-shaped text/i);
  assert.throws(() => evaluatePrivateFactFreshness(freshnessInput({
    sourceTimeMs: 4_102_444_800_000,
    receivedAtMs: 4_102_444_800_000,
    maxAgeMs: 1,
  }), 4_102_444_800_000), RangeError);
});
