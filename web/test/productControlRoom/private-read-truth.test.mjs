import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  INITIAL_REAL_DATA_CLIENT_TUPLE,
  PRIVATE_READ_ACCESS_DENIED_REASON,
  PRIVATE_READ_AUTH_REQUIRED_REASON,
  PRIVATE_READ_STALE_AFTER_MS,
  appliedPrivateReadSource,
  decodeApiPermissionsEnvelope,
  decodeM0SpotReadinessTruth,
  decodePrivateReadSnapshot,
  exactOrDash,
  hasMarginLiability,
  isZeroDecimal,
  m0SpotGate2ReadyNow,
  nextPrivateReadFreshnessExpiry,
  permissionPostureTone,
  permissionViolations,
  privateReadAccessReasonForStatus,
  privateReadErrorFact,
  privateReadExactZeroAdmitted,
  privateReadFreshness,
  projectPrivateRead,
  projectPrivateReadGuard,
  readPrivateReadStateField,
  reduceRealDataClientTuple,
  unavailablePrivateRead,
} from '../../src/lib/privateRead.ts';

const SOURCE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (relativePath) => readFile(join(SOURCE_ROOT, relativePath), 'utf8');

/** Every permission field the official provider readback now admits. */
const ADMITTED_PERMISSION_FLAGS = [
  'reading', 'ipRestricted', 'spotMarginTrading', 'margin', 'futures',
  'withdrawals', 'internalTransfer', 'universalTransfer', 'fixTrade',
  'portfolioMarginTrading', 'vanillaOptions', 'fixReadOnly',
];

function reconciled(observedAt = 1_720_000_000_000) {
  return { state: 'RECONCILED', observedAt, reason: null };
}

function partial(reason, observedAt = 1_720_000_000_000) {
  return { state: 'PARTIAL', observedAt, reason };
}

function coverage() {
  return { state: 'COMPLETE_CURRENT', symbols: [], limitation: null };
}

function verifiedPosture(observedAt = 1_720_000_000_000) {
  return {
    state: 'VERIFIED_READ_ONLY',
    observedAt,
    keyLabel: 'Binance Owner Read',
    keyLast4: 'A1B2',
    reading: true,
    spotMarginTrading: false,
    margin: false,
    futures: false,
    withdrawals: false,
    internalTransfer: false,
    universalTransfer: false,
    ipRestricted: true,
    fixTrade: false,
    portfolioMarginTrading: false,
    vanillaOptions: false,
    fixReadOnly: true,
  };
}

function availableFixture() {
  const observedAt = 1_720_000_000_000;
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'AVAILABLE',
    observedAt,
    permissionPosture: verifiedPosture(observedAt),
    spot: {
      state: 'AVAILABLE',
      observedAt,
      balances: [{ asset: 'USDT', free: '12.50000000', locked: '0.00000000' }],
      openOrders: [{
        symbol: 'BTCUSDT',
        orderId: '12345678901234567890',
        side: 'BUY',
        type: 'LIMIT',
        price: '62000.10000000',
        origQty: '0.00100000',
        executedQty: '0.00000000',
        status: 'NEW',
        time: observedAt,
      }],
      fills: [{
        symbol: 'BTCUSDT',
        id: '44',
        orderId: '43',
        price: '62000.00000000',
        qty: '0.00100000',
        quoteQty: '62.00000000',
        commission: '0.00000100',
        commissionAsset: 'BTC',
        time: observedAt,
        isBuyer: true,
      }],
      coverage: coverage(),
    },
    margin: {
      state: 'AVAILABLE',
      observedAt,
      totalAssetBtc: '0.10000000',
      totalLiabilityBtc: '0.01000000',
      totalNetAssetBtc: '0.09000000',
      assets: [{
        asset: 'USDT',
        free: '8.00000000',
        locked: '0.00000000',
        borrowed: '2.00000000',
        interest: '0.01000000',
        netAsset: '5.99000000',
      }],
      openOrders: [],
      fills: [],
      coverage: coverage(),
    },
    usdm: {
      state: 'AVAILABLE',
      observedAt,
      balances: [{
        asset: 'USDT',
        balance: '25.00000000',
        availableBalance: '20.00000000',
        crossWalletBalance: '25.00000000',
        crossUnPnl: '-1.25000000',
      }],
      positions: [{
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        positionAmt: '-0.00100000',
        entryPrice: '63000.00000000',
        markPrice: '62000.00000000',
        unRealizedProfit: '1.00000000',
        liquidationPrice: '0.00000000',
        leverage: null,
        marginType: null,
        isolatedMargin: '0.00000000',
        notional: '-62.00000000',
        updateTime: observedAt,
      }],
      openOrders: [],
      fills: [{
        symbol: 'BTCUSDT',
        id: '88',
        orderId: '87',
        side: 'SELL',
        positionSide: 'BOTH',
        price: '63000.00000000',
        qty: '0.00100000',
        quoteQty: '63.00000000',
        commission: '0.02500000',
        commissionAsset: 'USDT',
        realizedPnl: '0.00000000',
        time: observedAt,
        buyer: false,
        maker: true,
      }],
      coverage: coverage(),
    },
    reconciliation: {
      balances: partial('No independent balance invariant is computed.', observedAt),
      orders: partial('No independent order invariant is computed.', observedAt),
      fills: partial('Trade history is symbol-scoped.', observedAt),
      positions: partial('No independent position invariant is computed.', observedAt),
      // An open liability is never reconciled: the per-asset borrow cannot be
      // recomputed in BTC without a price source this candidate does not read.
      liabilities: {
        state: 'PARTIAL',
        observedAt,
        reason: 'Per-asset liabilities cannot be recomputed in BTC without a price source.',
      },
    },
  };
}

/** A flat Cross Margin account: the one shape whose liability is provable. */
function flatMarginFixture() {
  const fixture = availableFixture();
  fixture.margin.totalAssetBtc = '0.10000000';
  fixture.margin.totalLiabilityBtc = '0.00000000';
  fixture.margin.totalNetAssetBtc = '0.10000000';
  fixture.margin.assets = [{
    asset: 'USDT',
    free: '8.00000000',
    locked: '0.00000000',
    borrowed: '0.00000000',
    interest: '0.00000000',
    netAsset: '8.00000000',
  }];
  fixture.reconciliation.liabilities = reconciled(fixture.observedAt);
  return fixture;
}

function notConfiguredFixture() {
  const fact = () => ({ state: 'NOT_CONFIGURED', observedAt: null, reason: 'NOT_CONFIGURED' });
  const unavailableCoverage = () => ({ state: 'NOT_CONFIGURED', symbols: [], limitation: 'NOT_CONFIGURED' });
  const posture = {
    state: 'NOT_CONFIGURED',
    observedAt: null,
    keyLabel: 'Binance Private Read',
    keyLast4: null,
  };
  for (const flag of ADMITTED_PERMISSION_FLAGS) posture[flag] = null;
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'NOT_CONFIGURED',
    observedAt: null,
    permissionPosture: posture,
    spot: {
      state: 'NOT_CONFIGURED', observedAt: null, balances: null, openOrders: null,
      fills: null, coverage: unavailableCoverage(),
    },
    margin: {
      state: 'NOT_CONFIGURED', observedAt: null, totalAssetBtc: null,
      totalLiabilityBtc: null, totalNetAssetBtc: null, assets: null,
      openOrders: null, fills: null, coverage: unavailableCoverage(),
    },
    usdm: {
      state: 'NOT_CONFIGURED', observedAt: null, balances: null, positions: null,
      openOrders: null, fills: null, coverage: unavailableCoverage(),
    },
    reconciliation: {
      balances: fact(), orders: fact(), fills: fact(), positions: fact(), liabilities: fact(),
    },
  };
}

/** An unsafe key publishes no product truth and reconciles nothing. */
function unsafeFixture(violation = { withdrawals: true }) {
  const blank = unavailablePrivateRead('UNSAFE_PERMISSION_POSTURE');
  const observedAt = 1_720_000_000_000;
  return {
    ...availableFixture(),
    state: 'UNAVAILABLE',
    observedAt,
    permissionPosture: { ...verifiedPosture(observedAt), state: 'UNSAFE', ...violation },
    spot: blank.spot,
    margin: blank.margin,
    usdm: blank.usdm,
    reconciliation: blank.reconciliation,
  };
}

function m0SourceReadinessFixture(observedAtMs = 1_720_000_000_000) {
  return {
    schema: 'cosmos.system-integration.m0-spot-readiness-card.v1',
    version: 1,
    readinessDigest: `sha256:${'a'.repeat(64)}`,
    lifecycleCardDigest: null,
    disposition: 'SOURCE_READY_NOT_RUNTIME_VERIFIED',
    gate2Ready: false,
    evidenceAuthority: 'SOURCE_ONLY',
    observedAtMs,
    observedTimestampIst: '2024-07-04T05:56:40.000+05:30',
    validUntilMs: null,
    appExecutionArmed: {
      state: 'VERIFIED_CURRENT',
      current: false,
      proposed: 'REMAIN_DISARMED',
    },
    residualCondition: 'SOURCE_READY_NOT_RUNTIME_VERIFIED',
    exactLimitation: 'Source exists, but no runtime proof or owner action exists.',
    ownerAction: 'NO',
    effects: {
      privateCalls: 0,
      signatures: 0,
      transportCalls: 0,
      authorityConsumptions: 0,
      ledgerWrites: 0,
      orders: 0,
      moneyMutations: 0,
    },
    draftEvidenceMayGrowWithoutBecomingBrowserTruth: {
      state: 'UNKNOWN_NOT_VERIFIED',
    },
  };
}

test('strict v1 decoder accepts complete sanitized owner facts and preserves exact decimals', () => {
  const decoded = decodePrivateReadSnapshot(availableFixture());
  assert.ok(decoded);
  assert.equal(decoded.spot.balances[0].free, '12.50000000');
  assert.equal(decoded.margin.totalLiabilityBtc, '0.01000000');
  assert.equal(decoded.usdm.positions[0].notional, '-62.00000000');
  assert.equal(decoded.usdm.fills[0].realizedPnl, '0.00000000');

  const projection = projectPrivateRead(decoded, decoded.observedAt + 5_000);
  assert.equal(projection.stateLabel, 'Available');
  assert.equal(projection.postureLabel, 'Verified Read Only');
  assert.equal(projection.postureTone, 'ok');
  assert.equal(projection.identityLabel, 'Binance Owner Read · Ending A1B2');
  assert.equal(projection.spotAvailableUsdt, '12.50000000');
  assert.equal(projection.counts.openOrders, 1);
  assert.equal(projection.counts.fills, 2);
  assert.equal(projection.counts.positions, 1);
  assert.equal(projection.counts.liabilities, 1);
});

test('every admitted permission flag is carried end to end and decided fail-closed', () => {
  const decoded = decodePrivateReadSnapshot(availableFixture());
  assert.ok(decoded);
  for (const flag of ADMITTED_PERMISSION_FLAGS) {
    assert.equal(typeof decoded.permissionPosture[flag], 'boolean', `${flag} is not carried`);
  }
  assert.deepEqual(permissionViolations(decoded.permissionPosture), []);

  // A dropped field is a contract break, not a permission that is simply off.
  for (const flag of ADMITTED_PERMISSION_FLAGS) {
    const missing = availableFixture();
    delete missing.permissionPosture[flag];
    assert.equal(decodePrivateReadSnapshot(missing), null, `${flag} may not be omitted`);

    const wrongType = availableFixture();
    wrongType.permissionPosture[flag] = 'false';
    assert.equal(decodePrivateReadSnapshot(wrongType), null, `${flag} may not be a string`);
  }

  const extraFlag = availableFixture();
  extraFlag.permissionPosture.enableSomethingNew = false;
  assert.equal(decodePrivateReadSnapshot(extraFlag), null);

  // Every current contract flag must be proven as a boolean. FIX read-only
  // never changes the safe direction, but null is still an incomplete answer.
  for (const flag of ADMITTED_PERMISSION_FLAGS) {
    const unproven = availableFixture();
    unproven.permissionPosture[flag] = null;
    assert.equal(decodePrivateReadSnapshot(unproven), null, `${flag} null cannot stay VERIFIED_READ_ONLY`);
  }

  // Either observed boolean value is informational and safe.
  for (const fixReadOnly of [false, true]) {
    const informational = availableFixture();
    informational.permissionPosture.fixReadOnly = fixReadOnly;
    const accepted = decodePrivateReadSnapshot(informational);
    assert.ok(accepted, `fixReadOnly ${String(fixReadOnly)} must stay admissible`);
    assert.equal(accepted.permissionPosture.state, 'VERIFIED_READ_ONLY');
  }
  const fixReadOnlyOnly = unsafeFixture({ fixReadOnly: true });
  assert.equal(decodePrivateReadSnapshot(fixReadOnlyOnly), null, 'a read permission cannot prove UNSAFE');
});

test('each action or elevated permission renders visibly unsafe and names itself', () => {
  const elevated = {
    withdrawals: true,
    internalTransfer: true,
    universalTransfer: true,
    spotMarginTrading: true,
    margin: true,
    futures: true,
    fixTrade: true,
    portfolioMarginTrading: true,
    vanillaOptions: true,
    reading: false,
    ipRestricted: false,
  };
  for (const [flag, value] of Object.entries(elevated)) {
    const decoded = decodePrivateReadSnapshot(unsafeFixture({ [flag]: value }));
    assert.ok(decoded, `${flag} unsafe posture must decode`);
    assert.equal(decoded.permissionPosture.state, 'UNSAFE');
    assert.deepEqual(permissionViolations(decoded.permissionPosture), [flag]);

    const projection = projectPrivateRead(decoded);
    assert.equal(projection.postureTone, 'bad');
    assert.equal(projection.permissionRows.some((row) => row.tone === 'ok'), false);
    assert.match(projection.postureDetail, /^Unsafe permissions observed: /);
    assert.equal(projection.permissionViolationLabels.length, 1);
  }

  // A green claim without a violation is a contradiction in the other direction.
  const greenWithViolation = availableFixture();
  greenWithViolation.permissionPosture.vanillaOptions = true;
  assert.equal(decodePrivateReadSnapshot(greenWithViolation), null);
  const unsafeWithoutViolation = unsafeFixture({});
  assert.equal(decodePrivateReadSnapshot(unsafeWithoutViolation), null);
});

test('strict decoder rejects extras, secret-like material, malformed rows, and contradictory green posture', () => {
  const extraRoot = availableFixture();
  extraRoot.credential = 'forbidden';
  assert.equal(decodePrivateReadSnapshot(extraRoot), null);

  const extraNested = availableFixture();
  extraNested.spot.balances[0].raw = 'forbidden';
  assert.equal(decodePrivateReadSnapshot(extraNested), null);

  const secretLikeLabel = availableFixture();
  secretLikeLabel.permissionPosture.keyLabel = 'api_secret=forbidden';
  assert.equal(decodePrivateReadSnapshot(secretLikeLabel), null);

  const contradictory = availableFixture();
  contradictory.permissionPosture.withdrawals = true;
  assert.equal(decodePrivateReadSnapshot(contradictory), null);

  const malformedDecimal = availableFixture();
  malformedDecimal.margin.assets[0].borrowed = 'NaN';
  assert.equal(decodePrivateReadSnapshot(malformedDecimal), null);

  // Negative zero must be normalized by the server, never carried to the page.
  const negativeZero = availableFixture();
  negativeZero.margin.assets[0].borrowed = '-0.00000000';
  assert.equal(decodePrivateReadSnapshot(negativeZero), null);
});

test('USD-M leverage and margin mode stay truthful nulls rather than invented values', () => {
  const decoded = decodePrivateReadSnapshot(availableFixture());
  assert.ok(decoded);
  assert.equal(decoded.usdm.positions[0].leverage, null);
  assert.equal(decoded.usdm.positions[0].marginType, null);
  assert.equal(exactOrDash(decoded.usdm.positions[0].leverage), '—');

  const fabricated = availableFixture();
  fabricated.usdm.positions[0].leverage = '3';
  fabricated.usdm.positions[0].marginType = 'cross';
  assert.equal(
    decodePrivateReadSnapshot(fabricated),
    null,
    'V3 cannot support non-null leverage or margin mode compatibility claims',
  );

  for (const hostile of [0, 1, '', 'NaN', '1e3', {}, [], true]) {
    const badLeverage = availableFixture();
    badLeverage.usdm.positions[0].leverage = hostile;
    assert.equal(decodePrivateReadSnapshot(badLeverage), null, `leverage ${JSON.stringify(hostile)} must fail closed`);
  }
  for (const hostile of [0, '', 'cross margin', {}, [], true]) {
    const badMarginType = availableFixture();
    badMarginType.usdm.positions[0].marginType = hostile;
    assert.equal(decodePrivateReadSnapshot(badMarginType), null, `marginType ${JSON.stringify(hostile)} must fail closed`);
  }
});

test('fixed-scale and negative-zero liabilities are classified as observed zero, not as borrows', () => {
  assert.equal(isZeroDecimal('0'), true);
  assert.equal(isZeroDecimal('0.00000000'), true);
  assert.equal(isZeroDecimal('-0.00000000'), true);
  assert.equal(isZeroDecimal('0.00000001'), false);
  assert.equal(isZeroDecimal('-0.00000001'), false);
  assert.equal(isZeroDecimal(null), false);
  assert.equal(hasMarginLiability({ borrowed: '0.00000000', interest: '0.00000000' }), false);
  assert.equal(hasMarginLiability({ borrowed: '0.00000000', interest: '0.00000001' }), true);

  const normalizedZero = availableFixture();
  normalizedZero.margin.assets = [
    { asset: 'USDT', free: '8.00000000', locked: '0.00000000', borrowed: '0.00000000', interest: '0.00000000', netAsset: '8.00000000' },
    { asset: 'BTC', free: '0.00000000', locked: '0.00000000', borrowed: '0.00100000', interest: '0.00000000', netAsset: '-0.00100000' },
  ];
  const decoded = decodePrivateReadSnapshot(normalizedZero);
  assert.ok(decoded);
  const projection = projectPrivateRead(decoded);
  assert.equal(projection.counts.marginAssets, 2);
  assert.equal(projection.counts.liabilities, 1, 'a fixed-scale zero row is not a liability');
  // The exact provider string is preserved for display, not rewritten.
  assert.equal(decoded.margin.assets[0].borrowed, '0.00000000');
});

test('RECONCILED is admitted only where the decoder contract can support it', () => {
  // The provable case: totals balance, the total liability is zero, and no row
  // carries a borrow or accrued interest.
  const flat = decodePrivateReadSnapshot(flatMarginFixture());
  assert.ok(flat, 'a proven flat liability must stay admissible');
  assert.equal(flat.reconciliation.liabilities.state, 'RECONCILED');
  assert.equal(projectPrivateRead(flat).counts.liabilities, 0);

  const partialProduct = availableFixture();
  partialProduct.state = 'PARTIAL';
  partialProduct.spot.state = 'PARTIAL';
  partialProduct.spot.fills = null;
  partialProduct.spot.coverage = {
    state: 'PARTIAL_SYMBOL_SCOPED', symbols: ['BTCUSDT'], limitation: 'SYMBOL_SCOPED_HISTORY',
  };
  partialProduct.reconciliation.fills = reconciled(partialProduct.observedAt);
  assert.equal(
    decodePrivateReadSnapshot(partialProduct),
    null,
    'non-null rows under a partial product cannot carry RECONCILED',
  );

  for (const factId of ['balances', 'orders', 'fills', 'positions']) {
    const unsupported = availableFixture();
    unsupported.reconciliation[factId] = reconciled(unsupported.observedAt);
    assert.equal(
      decodePrivateReadSnapshot(unsupported),
      null,
      `${factId} provider reads do not prove an invariant`,
    );
  }

  // An open liability, a broken total, or a row that disagrees with the total
  // can never be published as a reconciled liability.
  const openLiability = flatMarginFixture();
  openLiability.margin.totalLiabilityBtc = '0.01000000';
  openLiability.margin.totalNetAssetBtc = '0.09000000';
  openLiability.margin.assets[0].borrowed = '2.00000000';
  assert.equal(decodePrivateReadSnapshot(openLiability), null);

  const brokenTotals = flatMarginFixture();
  brokenTotals.margin.totalNetAssetBtc = '0.09000000';
  assert.equal(decodePrivateReadSnapshot(brokenTotals), null);

  const rowDisagrees = flatMarginFixture();
  rowDisagrees.margin.assets[0].interest = '0.00000001';
  assert.equal(decodePrivateReadSnapshot(rowDisagrees), null);

  const missingAggregate = flatMarginFixture();
  missingAggregate.state = 'PARTIAL';
  missingAggregate.margin.state = 'PARTIAL';
  missingAggregate.margin.totalLiabilityBtc = null;
  assert.equal(decodePrivateReadSnapshot(missingAggregate), null);

  const unsafeButReconciled = unsafeFixture();
  unsafeButReconciled.reconciliation.balances = reconciled();
  assert.equal(
    decodePrivateReadSnapshot(unsafeButReconciled),
    null,
    'an unsafe key cannot reconcile anything',
  );

  // The server's own partial/unavailable states and reasons survive intact.
  const preserved = availableFixture();
  preserved.state = 'PARTIAL';
  preserved.spot.state = 'PARTIAL';
  preserved.spot.fills = null;
  preserved.spot.coverage = {
    state: 'PARTIAL_SYMBOL_SCOPED', symbols: ['BTCUSDT'], limitation: 'SYMBOL_SCOPED_HISTORY',
  };
  for (const factId of ['balances', 'orders', 'fills', 'positions', 'liabilities']) {
    preserved.reconciliation[factId] = {
      state: 'PARTIAL',
      observedAt: preserved.observedAt,
      reason: 'SYMBOL_SCOPED_HISTORY',
    };
  }
  const decoded = decodePrivateReadSnapshot(preserved);
  assert.ok(decoded);
  assert.equal(decoded.reconciliation.fills.state, 'PARTIAL');
  assert.equal(decoded.reconciliation.fills.reason, 'SYMBOL_SCOPED_HISTORY');
  assert.equal(projectPrivateRead(decoded).reconciliationLabel, 'Partial Reconciliation');
});

test('the freshness guard is bounded, explicit, and can only downgrade a claim', () => {
  const decoded = decodePrivateReadSnapshot(availableFixture());
  assert.ok(decoded);
  assert.equal(PRIVATE_READ_STALE_AFTER_MS, 45_000);

  const current = privateReadFreshness(decoded, decoded.observedAt + 5_000);
  assert.equal(current.state, 'CURRENT');
  assert.equal(current.tone, 'ok');
  assert.equal(current.ageMs, 5_000);
  assert.match(current.reason, /within the 45s account freshness bound/);

  const atBound = privateReadFreshness(decoded, decoded.observedAt + PRIVATE_READ_STALE_AFTER_MS);
  assert.equal(atBound.state, 'STALE');
  assert.equal(atBound.tone, 'warn');
  assert.match(atBound.reason, /beyond the 45s account freshness bound/);

  const future = privateReadFreshness(decoded, decoded.observedAt - 1);
  assert.equal(future.state, 'UNKNOWN');
  assert.equal(future.tone, 'warn');
  assert.match(future.reason, /ahead of the browser clock/);

  // The threshold is bounded, so a hostile override cannot disable the guard.
  assert.equal(privateReadFreshness(decoded, decoded.observedAt + 600_000, Number.POSITIVE_INFINITY).state, 'STALE');
  assert.equal(privateReadFreshness(decoded, decoded.observedAt + 600_001, 86_400_000).state, 'STALE');
  assert.equal(privateReadFreshness(decoded, decoded.observedAt + 15_000, 0).state, 'STALE');

  const fresh = projectPrivateRead(decoded, decoded.observedAt + 1_000);
  assert.equal(fresh.tone, 'ok');
  assert.equal(fresh.guardTone, 'ok');
  const stale = projectPrivateRead(decoded, decoded.observedAt + 10 * 60_000);
  assert.equal(stale.tone, 'ok', 'the decoded state itself is unchanged');
  assert.equal(stale.guardTone, 'warn', 'a stale observation cannot render green');
  assert.equal(stale.freshness.label, 'Stale Account Truth');

  const unknown = projectPrivateRead(unavailablePrivateRead('PRIVATE_READ_REQUEST_FAILED'));
  assert.equal(unknown.freshness.state, 'UNKNOWN');
  assert.equal(unknown.guardTone, 'bad');

  const unsafe = projectPrivateRead(decodePrivateReadSnapshot(unsafeFixture()));
  assert.equal(unsafe.freshness.state, 'UNKNOWN');
  assert.match(unsafe.freshness.reason, /No private account rows were admitted/);

  const notConfigured = projectPrivateRead(decodePrivateReadSnapshot(notConfiguredFixture()));
  assert.equal(notConfigured.freshness.state, 'NOT_CONFIGURED');
  assert.equal(notConfigured.guardTone, 'idle');
});

test('freshness expiry schedules the earlier account or permission boundary without transport work', async () => {
  const fixture = availableFixture();
  fixture.permissionPosture.observedAt = fixture.observedAt - 10_000;
  const decoded = decodePrivateReadSnapshot(fixture);
  assert.ok(decoded);

  const now = fixture.observedAt + 1_000;
  const permissionExpiry = fixture.permissionPosture.observedAt + PRIVATE_READ_STALE_AFTER_MS;
  const accountExpiry = fixture.observedAt + PRIVATE_READ_STALE_AFTER_MS;
  assert.equal(nextPrivateReadFreshnessExpiry(decoded, now), permissionExpiry);
  assert.equal(nextPrivateReadFreshnessExpiry(decoded, permissionExpiry), accountExpiry);
  assert.equal(nextPrivateReadFreshnessExpiry(decoded, accountExpiry), null);
  assert.equal(nextPrivateReadFreshnessExpiry(decoded, Number.NaN), null);

  const store = await read('store.tsx');
  assert.match(store, /nextPrivateReadFreshnessExpiry\(\s*realDataClient\.privateRead\.snapshot,\s*now,?\s*\)/);
  assert.match(store, /window\.setTimeout\([\s\S]*bumpPrivateReadFreshness/);
  assert.match(store, /window\.clearTimeout\(timer\)/);
  const scheduler = store.slice(
    store.indexOf('// A mounted consumer must cross the same freshness boundary'),
    store.indexOf('// The canonical socket only speaks', store.indexOf('// A mounted consumer must cross the same freshness boundary')),
  );
  assert.doesNotMatch(scheduler, /fetchJson|createSettledPoll|\.refresh\(/);
});

test('available exact-empty arrays stay distinguishable from unavailable unknown arrays', () => {
  const exactEmpty = availableFixture();
  exactEmpty.spot.balances = [];
  exactEmpty.spot.openOrders = [];
  exactEmpty.spot.fills = [];
  exactEmpty.margin.assets = [];
  exactEmpty.usdm.balances = [];
  exactEmpty.usdm.positions = [];
  exactEmpty.usdm.fills = [];
  const decodedEmpty = decodePrivateReadSnapshot(exactEmpty);
  assert.ok(decodedEmpty);
  const emptyProjection = projectPrivateRead(decodedEmpty);
  assert.equal(emptyProjection.counts.spotBalances, 0);
  assert.equal(emptyProjection.counts.openOrders, 0);
  assert.equal(emptyProjection.counts.fills, 0);
  assert.equal(emptyProjection.counts.positions, 0);
  assert.equal(emptyProjection.counts.liabilities, 0);

  const unavailable = unavailablePrivateRead('PRIVATE_READ_REQUEST_FAILED');
  const unavailableProjection = projectPrivateRead(unavailable);
  assert.equal(unavailableProjection.stateLabel, 'Unavailable');
  assert.equal(unavailableProjection.counts.spotBalances, null);
  assert.equal(unavailableProjection.counts.openOrders, null);
  assert.equal(unavailableProjection.counts.fills, null);
  assert.equal(unavailableProjection.counts.positions, null);
  assert.equal(unavailableProjection.counts.liabilities, null);
  assert.equal(exactOrDash(null), '—');
});

test('exact zero claims require current preferred complete reconciled truth', () => {
  const exactEmpty = flatMarginFixture();
  exactEmpty.spot.balances = [{ asset: 'USDT', free: '0.00000000', locked: '0.00000000' }];
  exactEmpty.spot.openOrders = [];
  exactEmpty.spot.fills = [];
  exactEmpty.margin.openOrders = [];
  exactEmpty.margin.fills = [];
  exactEmpty.usdm.balances = [];
  exactEmpty.usdm.positions = [];
  exactEmpty.usdm.openOrders = [];
  exactEmpty.usdm.fills = [];
  const decoded = decodePrivateReadSnapshot(exactEmpty);
  assert.ok(decoded);
  const currentNow = decoded.observedAt + 1_000;

  const currentGuard = projectPrivateReadGuard({
    snapshot: decoded,
    source: 'STATE',
    error: null,
    now: currentNow,
  });
  const current = currentGuard.presentation;
  assert.equal(current.counts.openOrders, null, 'order absence stays unknown without reconciled order truth');
  assert.equal(current.counts.fills, null, 'fill absence stays unknown without reconciled fill truth');
  assert.equal(current.counts.positions, null, 'position absence stays unknown without reconciled position truth');
  assert.equal(current.counts.liabilities, 0);
  assert.equal(current.spotAvailableUsdt, null, 'a zero balance stays unknown without reconciled balance truth');
  assert.equal(current.marginLiabilityBtc, '0.00000000');
  assert.equal(currentGuard.renderSnapshot.spot.balances, null);
  assert.equal(currentGuard.renderSnapshot.spot.openOrders, null);
  assert.equal(currentGuard.renderSnapshot.margin.openOrders, null);
  assert.equal(currentGuard.renderSnapshot.usdm.openOrders, null);
  assert.equal(currentGuard.renderSnapshot.usdm.positions, null);
  assert.ok(currentGuard.renderSnapshot.margin.assets);
  assert.equal(currentGuard.renderSnapshot.margin.totalLiabilityBtc, '0.00000000');
  assert.equal(privateReadExactZeroAdmitted({
    snapshot: decoded,
    source: 'STATE',
    error: null,
    fact: 'LIABILITIES',
    now: currentNow,
  }), true);
  assert.equal(privateReadExactZeroAdmitted({
    snapshot: decoded,
    source: 'STATE',
    error: null,
    fact: 'OPEN_ORDERS',
    now: currentNow,
  }), false);

  const partialCoverage = {
    ...decoded,
    margin: {
      ...decoded.margin,
      coverage: {
        state: 'PARTIAL_SYMBOL_SCOPED',
        symbols: ['USDT'],
        limitation: 'SYMBOL_SCOPED_HISTORY',
      },
    },
  };

  for (const guard of [
    projectPrivateReadGuard({ snapshot: decoded, source: 'FALLBACK', error: null, now: currentNow }),
    projectPrivateReadGuard({ snapshot: decoded, source: 'STATE', error: 'HTTP_503', now: currentNow }),
    projectPrivateReadGuard({ snapshot: partialCoverage, source: 'STATE', error: null, now: currentNow }),
    projectPrivateReadGuard({
      snapshot: decoded,
      source: 'STATE',
      error: null,
      now: decoded.observedAt + PRIVATE_READ_STALE_AFTER_MS,
    }),
  ]) {
    assert.equal(guard.presentation.counts.openOrders, null);
    assert.equal(guard.presentation.counts.fills, null);
    assert.equal(guard.presentation.counts.positions, null);
    assert.equal(guard.presentation.counts.liabilities, null);
    assert.equal(guard.presentation.spotAvailableUsdt, null);
    assert.equal(guard.presentation.marginLiabilityBtc, null);
    assert.equal(guard.renderSnapshot.spot.balances, null);
    assert.equal(guard.renderSnapshot.spot.openOrders, null);
    assert.equal(guard.renderSnapshot.margin.assets, null);
    assert.equal(guard.renderSnapshot.usdm.positions, null);
    assert.equal(guard.renderSnapshot.margin.totalLiabilityBtc, null);
  }

  const positive = availableFixture();
  const positiveDecoded = decodePrivateReadSnapshot(positive);
  assert.ok(positiveDecoded);
  const retained = projectPrivateReadGuard({
    snapshot: positiveDecoded,
    source: 'FALLBACK',
    error: 'HTTP_503',
    now: positiveDecoded.observedAt + PRIVATE_READ_STALE_AFTER_MS,
  }).presentation;
  assert.equal(retained.counts.openOrders, 1, 'nonzero retained observations are not fabricated absence');
  assert.equal(retained.counts.liabilities, 1);
  assert.equal(retained.spotAvailableUsdt, '12.50000000');
});

test('private-read HTTP admission is status-authoritative for 401 and 403', async () => {
  assert.equal(privateReadAccessReasonForStatus(401), PRIVATE_READ_AUTH_REQUIRED_REASON);
  assert.equal(privateReadAccessReasonForStatus(403), PRIVATE_READ_ACCESS_DENIED_REASON);
  assert.equal(privateReadAccessReasonForStatus(400), null);
  assert.equal(privateReadAccessReasonForStatus(500), null);
  assert.equal(privateReadAccessReasonForStatus('401'), null);

  const authentication = privateReadErrorFact(PRIVATE_READ_AUTH_REQUIRED_REASON);
  assert.equal(authentication.id, 'AUTH_REQUIRED');
  assert.equal(authentication.label, 'AUTH REQUIRED');
  assert.match(authentication.detail, /provider state is UNKNOWN/);

  const access = privateReadErrorFact(PRIVATE_READ_ACCESS_DENIED_REASON);
  assert.equal(access.id, 'ACCESS_DENIED');
  assert.equal(access.label, 'ACCESS DENIED');
  assert.match(access.detail, /provider state is UNKNOWN/);

  const store = await read('store.tsx');
  assert.match(store, /error instanceof ApiRequestError\s*\? privateReadAccessReasonForStatus\(error\.status\)/);
  assert.equal((store.match(/const failure = privateReadFailure\(cause\);/g) ?? []).length, 3);
  assert.doesNotMatch(store, /privateReadAccessReasonForStatus\([^)]*\.code/);
});

test('one ordered client tuple distinguishes missing, invalid, exact-empty, and retained failure', () => {
  let tuple = INITIAL_REAL_DATA_CLIENT_TUPLE;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 1,
    observedAtMs: 10,
    field: readPrivateReadStateField({ state: 'compatibility-without-private-read' }),
  });
  assert.equal(tuple.privateRead.status, 'UNAVAILABLE');
  assert.equal(tuple.privateRead.transport, 'FALLBACK');
  assert.equal(tuple.privateRead.source, null);
  assert.equal(tuple.privateRead.failure.kind, 'MISSING');
  assert.equal(tuple.privateRead.failure.code, 'PRIVATE_READ_STATE_FIELD_MISSING');
  const invalidInitial = reduceRealDataClientTuple(INITIAL_REAL_DATA_CLIENT_TUPLE, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 1,
    observedAtMs: 10,
    field: readPrivateReadStateField({ privateRead: null }),
  });
  assert.equal(invalidInitial.privateRead.status, 'UNAVAILABLE');
  assert.equal(invalidInitial.privateRead.failure.kind, 'CONTRACT');
  assert.equal(invalidInitial.privateRead.failure.code, 'PRIVATE_READ_STATE_CONTRACT_INVALID');

  const fallback = availableFixture();
  fallback.spot.balances[0].free = '99.00000000';
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_FALLBACK_RESULT',
    requestId: 2,
    observedAtMs: 20,
    payload: fallback,
  });
  assert.equal(tuple.privateRead.status, 'CURRENT');
  assert.equal(tuple.privateRead.source, 'FALLBACK');
  assert.equal(tuple.privateRead.snapshot.spot.balances[0].free, '99.00000000');

  const retainedFallback = tuple.privateRead.snapshot;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 3,
    observedAtMs: 30,
    field: readPrivateReadStateField({ privateRead: null }),
  });
  assert.equal(tuple.privateRead.status, 'CURRENT');
  assert.equal(tuple.privateRead.snapshot, retainedFallback);
  assert.equal(tuple.privateRead.failure, null);

  const exactEmpty = availableFixture();
  exactEmpty.spot.balances = [];
  exactEmpty.spot.openOrders = [];
  exactEmpty.spot.fills = [];
  exactEmpty.margin.assets = [];
  exactEmpty.margin.openOrders = [];
  exactEmpty.margin.fills = [];
  exactEmpty.usdm.balances = [];
  exactEmpty.usdm.positions = [];
  exactEmpty.usdm.openOrders = [];
  exactEmpty.usdm.fills = [];
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 4,
    observedAtMs: 40,
    field: readPrivateReadStateField({ privateRead: exactEmpty }),
  });
  assert.equal(tuple.privateRead.status, 'CURRENT');
  assert.equal(tuple.privateRead.source, 'STATE');
  assert.equal(tuple.privateRead.transport, 'STATE');
  assert.deepEqual(tuple.privateRead.snapshot.spot.balances, []);
  assert.deepEqual(tuple.privateRead.snapshot.usdm.positions, []);

  const retainedExactEmpty = tuple.privateRead.snapshot;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_FALLBACK_FAILURE',
    requestId: 5,
    observedAtMs: 50,
    failure: { code: 'HTTP_503', message: 'Fallback unavailable.' },
  });
  assert.equal(tuple.privateRead.status, 'RETAINED_FAILURE');
  assert.equal(tuple.privateRead.snapshot, retainedExactEmpty);
  assert.equal(tuple.privateRead.source, 'STATE');
  assert.equal(tuple.privateRead.failure.kind, 'TRANSPORT');
});

test('display provenance cannot be relabelled by an older state response', () => {
  let tuple = reduceRealDataClientTuple(INITIAL_REAL_DATA_CLIENT_TUPLE, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 1,
    observedAtMs: 10,
    field: { presence: 'MISSING' },
  });
  assert.equal(tuple.privateRead.transport, 'FALLBACK');
  assert.equal(tuple.privateRead.source, null);
  assert.equal(appliedPrivateReadSource(tuple.privateRead), 'PENDING');
  const fallback = availableFixture();
  fallback.spot.balances[0].free = '88.00000000';
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_FALLBACK_RESULT',
    requestId: 3,
    observedAtMs: 30,
    payload: fallback,
  });
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 2,
    observedAtMs: 20,
    field: { presence: 'PRESENT', value: availableFixture() },
  });
  assert.equal(tuple.privateRead.transport, 'STATE');
  assert.equal(tuple.privateRead.source, 'FALLBACK');
  assert.equal(appliedPrivateReadSource(tuple.privateRead), 'FALLBACK');
  assert.equal(tuple.privateRead.snapshot.spot.balances[0].free, '88.00000000');
  assert.equal(tuple.privateRead.appliedRequestId, 3);
  assert.equal(tuple.privateRead.stateDecisionRequestId, 2);
});

test('failed state recovery probes cannot suppress or downgrade fallback truth', () => {
  let tuple = reduceRealDataClientTuple(INITIAL_REAL_DATA_CLIENT_TUPLE, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 1,
    observedAtMs: 10,
    field: { presence: 'MISSING' },
  });
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 4,
    observedAtMs: 40,
    field: { presence: 'PRESENT', value: null },
  });
  assert.equal(tuple.privateRead.appliedRequestId, 1);
  assert.equal(tuple.privateRead.stateDecisionRequestId, 4);

  const afterNewerInvalidProbe = tuple;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_RESULT',
    requestId: 3,
    observedAtMs: 30,
    field: { presence: 'PRESENT', value: availableFixture() },
  });
  assert.equal(tuple, afterNewerInvalidProbe);

  const fallback = availableFixture();
  fallback.spot.balances[0].free = '77.00000000';
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_FALLBACK_RESULT',
    requestId: 2,
    observedAtMs: 20,
    payload: fallback,
  });
  assert.equal(tuple.privateRead.status, 'CURRENT');
  assert.equal(tuple.privateRead.source, 'FALLBACK');
  assert.equal(tuple.privateRead.snapshot.spot.balances[0].free, '77.00000000');

  const admittedFallback = tuple.privateRead.snapshot;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'PRIVATE_STATE_FAILURE',
    requestId: 5,
    observedAtMs: 50,
    failure: { code: 'HTTP_503', message: 'State recovery probe unavailable.' },
  });
  assert.equal(tuple.privateRead.status, 'CURRENT');
  assert.equal(tuple.privateRead.snapshot, admittedFallback);
  assert.equal(tuple.privateRead.failure, null);
  assert.equal(tuple.privateRead.appliedRequestId, 2);
  assert.equal(tuple.privateRead.stateDecisionRequestId, 5);
});

test('M0 readiness is separately decoded, non-authorizing, and retained on refresh failure', () => {
  const receivedAtMs = 1_720_000_000_100;
  const sourceOnly = m0SourceReadinessFixture(receivedAtMs);
  const decodedSource = decodeM0SpotReadinessTruth(sourceOnly, receivedAtMs);
  assert.ok(decodedSource);
  assert.equal(decodedSource.gate2Ready, false);
  assert.equal(decodedSource.ownerAction, 'NO');

  let tuple = reduceRealDataClientTuple(INITIAL_REAL_DATA_CLIENT_TUPLE, {
    kind: 'M0_READINESS_RESULT',
    requestId: 1,
    observedAtMs: receivedAtMs,
    payload: sourceOnly,
  });
  assert.equal(tuple.m0SpotReadiness.status, 'CURRENT');
  assert.equal(tuple.m0SpotReadiness.card.disposition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
  assert.equal(m0SpotGate2ReadyNow(tuple.m0SpotReadiness, receivedAtMs), false);
  const retainedCard = tuple.m0SpotReadiness.card;
  tuple = reduceRealDataClientTuple(tuple, {
    kind: 'M0_READINESS_FAILURE',
    requestId: 2,
    observedAtMs: receivedAtMs + 10,
    failure: { code: 'HTTP_503', message: 'Readiness unavailable.' },
  });
  assert.equal(tuple.m0SpotReadiness.status, 'RETAINED_FAILURE');
  assert.equal(tuple.m0SpotReadiness.card, retainedCard);
  assert.equal(tuple.m0SpotReadiness.failure.kind, 'TRANSPORT');

  const ready = {
    ...m0SourceReadinessFixture(receivedAtMs - 100),
    lifecycleCardDigest: `sha256:${'b'.repeat(64)}`,
    disposition: 'READY_FOR_OWNER_GATE_2',
    gate2Ready: true,
    evidenceAuthority: 'RUNTIME_PRIVATE',
    validUntilMs: receivedAtMs + 1_000,
    appExecutionArmed: {
      state: 'VERIFIED_CURRENT',
      current: false,
      proposed: 'ARM_EXACT_CARD_AFTER_OWNER_YES',
    },
    residualCondition: 'READY_FOR_OWNER_GATE_2',
    exactLimitation: null,
    ownerAction: 'YES',
  };
  assert.equal(
    decodeM0SpotReadinessTruth(ready, receivedAtMs),
    null,
    'outer READY fields cannot bypass the producer-only full-card validator',
  );
  const falseReadyTuple = reduceRealDataClientTuple(tuple, {
    kind: 'M0_READINESS_RESULT',
    requestId: 3,
    observedAtMs: receivedAtMs,
    payload: ready,
  });
  assert.equal(falseReadyTuple.m0SpotReadiness.status, 'RETAINED_FAILURE');
  assert.equal(falseReadyTuple.m0SpotReadiness.card, retainedCard);
  assert.equal(falseReadyTuple.m0SpotReadiness.failure.kind, 'CONTRACT');
  assert.equal(m0SpotGate2ReadyNow(falseReadyTuple.m0SpotReadiness, receivedAtMs), false);
});

test('partial and not-configured contracts remain non-green and preserve explicit limitations', () => {
  const partial = availableFixture();
  partial.state = 'PARTIAL';
  partial.spot.state = 'PARTIAL';
  partial.spot.coverage = {
    state: 'PARTIAL_SYMBOL_SCOPED',
    symbols: ['BTCUSDT'],
    limitation: 'SYMBOL_SCOPED_HISTORY',
  };
  for (const factId of ['balances', 'orders', 'fills', 'positions', 'liabilities']) {
    partial.reconciliation[factId] = {
      state: 'PARTIAL',
      observedAt: partial.observedAt,
      reason: 'SYMBOL_SCOPED_HISTORY',
    };
  }
  const decodedPartial = decodePrivateReadSnapshot(partial);
  assert.ok(decodedPartial);
  const nonzeroProjection = projectPrivateRead(decodedPartial);
  const nonzeroGuard = projectPrivateReadGuard({
    snapshot: decodedPartial,
    source: 'STATE',
    error: null,
    now: decodedPartial.observedAt + 1,
  });
  assert.equal(nonzeroProjection.tone, 'warn');
  assert.equal(nonzeroProjection.coverageLabel, 'Partial Symbol-Scoped History');
  assert.equal(nonzeroProjection.counts.openOrders, 1, 'PARTIAL keeps an observed nonzero order count');
  assert.equal(nonzeroProjection.spotAvailableUsdt, '12.50000000', 'PARTIAL keeps an observed nonzero balance');
  assert.equal(nonzeroGuard.overallTone, 'warn', 'an observed nonzero does not upgrade PARTIAL');
  assert.match(nonzeroGuard.statusLabel, /^PARTIAL/);
  assert.equal(decodedPartial.spot.coverage.symbols[0], 'BTCUSDT');

  const partialZero = structuredClone(partial);
  partialZero.spot.openOrders = [];
  partialZero.spot.balances[0].free = '0.00000000';
  const decodedPartialZero = decodePrivateReadSnapshot(partialZero);
  assert.ok(decodedPartialZero);
  const zeroProjection = projectPrivateRead(decodedPartialZero);
  const zeroGuard = projectPrivateReadGuard({
    snapshot: decodedPartialZero,
    source: 'STATE',
    error: null,
    now: decodedPartialZero.observedAt + 1,
  });
  assert.equal(zeroProjection.counts.openOrders, 0, 'PARTIAL keeps an observed exact zero distinct from unknown');
  assert.equal(zeroProjection.spotAvailableUsdt, '0.00000000', 'PARTIAL keeps an observed fixed-scale zero balance');
  assert.equal(zeroGuard.overallTone, 'warn', 'an observed zero does not become a green absence claim');
  assert.match(zeroGuard.statusLabel, /^PARTIAL/);

  const decodedNotConfigured = decodePrivateReadSnapshot(notConfiguredFixture());
  assert.ok(decodedNotConfigured);
  const notConfiguredProjection = projectPrivateRead(decodedNotConfigured);
  assert.equal(notConfiguredProjection.stateLabel, 'Not Configured');
  assert.equal(notConfiguredProjection.tone, 'idle');
  assert.equal(notConfiguredProjection.postureTone, 'idle');
  assert.equal(notConfiguredProjection.reconciliationLabel, 'Reconciliation Not Configured');
});

test('only a fully verified read-only permission posture can render green', () => {
  assert.equal(permissionPostureTone('VERIFIED_READ_ONLY'), 'ok');
  assert.equal(permissionPostureTone('UNSAFE'), 'bad');
  assert.equal(permissionPostureTone('UNKNOWN'), 'warn');
  assert.equal(permissionPostureTone('NOT_CONFIGURED'), 'idle');

  const decoded = decodePrivateReadSnapshot(unsafeFixture());
  assert.ok(decoded);
  const projection = projectPrivateRead(decoded);
  assert.equal(projection.postureTone, 'bad');
  assert.equal(projection.permissionRows.some((row) => row.tone === 'ok'), false);
  assert.equal(projection.permissionRows.find((row) => row.id === 'withdrawals').tone, 'bad');
  assert.equal(projection.reconciliationLabel, 'Reconciliation Unavailable');
});

test('API permission envelope is exact and last-4 is the only key fragment presented', () => {
  const posture = verifiedPosture();
  const decoded = decodeApiPermissionsEnvelope({
    schemaVersion: 'binance.api-permissions.v1',
    permissionPosture: posture,
  });
  assert.ok(decoded);
  for (const flag of ADMITTED_PERMISSION_FLAGS) {
    assert.equal(typeof decoded.permissionPosture[flag], 'boolean');
  }
  const identity = projectPrivateRead(availableFixture()).identityLabel;
  assert.equal(identity, 'Binance Owner Read · Ending A1B2');
  assert.doesNotMatch(identity, /api[_-]?key|secret|signature|[A-Za-z0-9]{20,}/i);
  assert.equal(decodeApiPermissionsEnvelope({
    schemaVersion: 'binance.api-permissions.v1',
    permissionPosture: posture,
    extra: true,
  }), null);
  assert.equal(decodeApiPermissionsEnvelope({
    schemaVersion: 'binance.api-permissions.v1',
    permissionPosture: { ...posture, keyLast4: 'A1B2C3' },
  }), null);
});

test('Risk and Token reuse the centralized privateRead tuple without a page-local account poll', async () => {
  const [risk, token] = await Promise.all([
    read('pages/Risk.tsx'),
    read('pages/TokenDetail.tsx'),
  ]);

  for (const source of [risk, token]) {
    assert.match(source, /projectPrivateReadGuard\(\{/);
    assert.match(source, /snapshot:\s*privateRead/);
    assert.match(source, /source:\s*privateReadSource/);
    assert.match(source, /error:\s*privateReadError/);
  }
  assert.match(risk, /const openOrdersCount = privatePresentation\.counts\.openOrders/);
  assert.match(risk, /Observed zero is retained; a partial guard does not prove current absence/);
  assert.match(risk, /OBSERVED.*privateRead\.reconciliation\.orders\.state.*privateReadGuard\.statusLabel/s);
  assert.match(token, /symbolOpenOrderCount\(privateRead, symbol\)/);
  assert.match(token, /privateRead\.reconciliation\.orders\.state/);
  assert.match(token, /privateRead\.reconciliation\.balances\.state/);
  assert.doesNotMatch(
    token,
    /\/api\/symbol\/context|SymbolAccountContext|parseSymbolAccountContext|accountContext|setAccountContext/,
  );
  assert.doesNotMatch(token, /createSettledPoll<[^>]*(?:Account|Balance|Order)/);
});

test('mounted private-read surfaces consume one projection and retain no money-action controls', async () => {
  const [account, dashboard, loans, health, header, store, owner, styles] = await Promise.all([
    read('pages/Account.tsx'),
    read('pages/Dashboard.tsx'),
    read('pages/Loans.tsx'),
    read('pages/SystemHealth.tsx'),
    read('components/Header.tsx'),
    read('store.tsx'),
    read('lib/privateRead.ts'),
    read('styles.css'),
  ]);
  const combined = [account, dashboard, loans, health, header].join('\n');
  for (const source of [account, dashboard, loans, health, header]) {
    assert.match(source, /projectPrivateRead/);
  }
  assert.match(store, /readPrivateReadStateField\(snapshot\)/);
  assert.match(store, /const privateReadGuard = projectPrivateReadGuard\(\{/);
  assert.match(store, /snapshot: privateReadClient\.snapshot/);
  assert.match(store, /privateRead: privateReadGuard\.renderSnapshot/);
  assert.match(store, /realDataClient\.privateRead\.transport !== 'FALLBACK'/);
  assert.match(store, /createSettledPoll<unknown>/);
  assert.match(owner, /'Reading'/);
  assert.match(owner, /'Spot \/ Margin Trading'/);
  assert.match(owner, /'Margin'/);
  assert.match(owner, /'Futures'/);
  assert.match(owner, /'Withdrawals'/);
  assert.match(owner, /'Transfers'/);
  assert.match(owner, /'IP Restriction'/);
  // The compact key sheet keeps exactly the seven rows its grid declares.
  assert.equal(projectPrivateRead(unavailablePrivateRead()).permissionRows.length, 7);
  assert.match(styles, /\.api-permission-list\s*\{\s*grid-template-rows:\s*repeat\(7,/);
  assert.doesNotMatch(combined, /<button[^>]*>\s*(?:Trade|Cancel Order|Borrow|Repay|Transfer|Withdraw)/i);
  assert.doesNotMatch(combined, /clientOrderId|apiSecret|secretKey|signatureValue|whitelistContents/);
  assert.match(account, /No cross-product valuation is published/);
  assert.match(loans, /Borrowed And Accrued Interest Remain In Asset Units/);
  assert.match(health, /Private Account \{privatePresentation\.stateLabel\}/);
});

test('the private-account surfaces present the freshness guard and never invent position facts', async () => {
  const [account, dashboard, loans, health, store] = await Promise.all([
    read('pages/Account.tsx'),
    read('pages/Dashboard.tsx'),
    read('pages/Loans.tsx'),
    read('pages/SystemHealth.tsx'),
    read('store.tsx'),
  ]);

  for (const source of [account, dashboard, loans, health]) {
    assert.match(source, /freshness\.(?:label|reason|state)/);
  }
  for (const source of [account, dashboard, loans]) {
    assert.match(source, /guardTone/, 'a stale snapshot must not keep a green source badge');
  }
  const accountSync = dashboard.match(/label: 'Account Sync',[\s\S]*?\n\s*},/)?.[0] ?? '';
  assert.match(accountSync, /privatePresentation\.freshness\.label/);
  assert.match(accountSync, /tone: privatePresentation\.guardTone/);
  assert.doesNotMatch(accountSync, /tone: privatePresentation\.tone/);
  assert.match(account, /position\.marginType \?\? 'Margin Mode Not Published'/);
  assert.match(account, /position\.leverage === null/);
  assert.doesNotMatch(account, /position\.leverage \?\? '1'|marginType \?\? 'cross'/i);
  assert.match(health, /privateRead\.permissionPosture\.state === 'UNSAFE'/);
  assert.match(health, /privatePresentation\.postureDetail/);
  assert.match(loans, /hasMarginLiability/);
  assert.doesNotMatch(loans, /borrowed !== '0'|interest !== '0'/);

  // Signed-in account truth advances on a bounded cadence without a second
  // private transport, and every private read is abortable and ordered.
  assert.match(store, /privateReadCadenceRef/);
  assert.match(store, /requestCompatibilityState\('CADENCE'\)/);
  assert.match(store, /window\.setInterval\(\(\) => privateReadCadenceRef\.current\?\.\(\), intervalMs\)/);
  assert.match(store, /window\.clearInterval\(timer\)/);
  assert.match(store, /if \(trigger === 'DELTA'\) stateRefreshQueued = true/);
  assert.match(store, /reduceRealDataClientTuple\(current, event\)/);
  assert.match(store, /PRIVATE_STATE_FAILURE/);
  assert.match(store, /PRIVATE_FALLBACK_FAILURE/);
  assert.match(store, /stateRefreshController\?\.abort\(\)/);
  assert.equal((store.match(/\/api\/private-account/g) ?? []).length, 1);
  assert.equal((store.match(/\/api\/system-integration\/m0\/spot-canary/g) ?? []).length, 1);
  assert.match(store, /!await refreshM0Readiness\(\)/);
  assert.match(store, /M0 readiness refresh failed/);
  assert.doesNotMatch(store, /\/api\/system-integration\/m0\/spot-canary[\s\S]{0,160}method:\s*'POST'/);
});
