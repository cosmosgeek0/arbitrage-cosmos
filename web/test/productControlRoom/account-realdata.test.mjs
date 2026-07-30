import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  decodePrivateReadSnapshot,
  projectPrivateRead,
  unavailablePrivateRead,
} from '../../src/lib/privateRead.ts';
import { projectAccountTruth } from '../../src/pages/accountTruth.ts';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

function currentSnapshot(observedAt = 1_720_000_000_000) {
  const coverage = () => ({
    state: 'PARTIAL_SYMBOL_SCOPED',
    symbols: ['BTCUSDT'],
    limitation: 'Configured fill history is symbol-scoped.',
  });
  const partial = (reason) => ({ state: 'PARTIAL', observedAt, reason });
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'PARTIAL',
    observedAt,
    permissionPosture: {
      state: 'VERIFIED_READ_ONLY',
      observedAt,
      keyLabel: 'Owner Read',
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
    },
    spot: {
      state: 'PARTIAL',
      observedAt,
      balances: [{ asset: 'USDT', free: '12.50000000', locked: '0.25000000' }],
      openOrders: [{
        symbol: 'BTCUSDT',
        orderId: '101',
        side: 'BUY',
        type: 'LIMIT',
        price: '62000.10000000',
        origQty: '0.00100000',
        executedQty: '0.00000000',
        status: 'NEW',
        time: observedAt - 2_000,
      }],
      fills: [{
        symbol: 'BTCUSDT',
        id: '201',
        orderId: '101',
        price: '61000.00000000',
        qty: '0.00100000',
        quoteQty: '61.00000000',
        commission: '0.00000100',
        commissionAsset: 'BTC',
        time: observedAt - 4_000,
        isBuyer: true,
      }],
      coverage: coverage(),
    },
    margin: {
      state: 'PARTIAL',
      observedAt: observedAt - 500,
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
      openOrders: [{
        symbol: 'BTCUSDT',
        orderId: '102',
        side: 'SELL',
        type: 'LIMIT',
        price: '64000.00000000',
        origQty: '0.00200000',
        executedQty: '0.00100000',
        status: 'PARTIALLY_FILLED',
        time: observedAt - 1_000,
      }],
      fills: [],
      coverage: coverage(),
    },
    usdm: {
      state: 'PARTIAL',
      observedAt: observedAt - 250,
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
        positionAmt: '0.00000000',
        entryPrice: '63000.00000000',
        markPrice: '62000.00000000',
        unRealizedProfit: '0.00000000',
        liquidationPrice: '0.00000000',
        leverage: null,
        marginType: null,
        isolatedMargin: '0.00000000',
        notional: '0.00000000',
        updateTime: observedAt - 250,
      }],
      openOrders: [{
        symbol: 'BTCUSDT',
        orderId: '103',
        side: 'BUY',
        positionSide: 'BOTH',
        type: 'LIMIT',
        price: '60000.00000000',
        origQty: '0.00300000',
        executedQty: '0.00000000',
        status: 'NEW',
        time: observedAt,
        updateTime: observedAt,
        reduceOnly: false,
      }],
      fills: [{
        symbol: 'BTCUSDT',
        id: '203',
        orderId: '103',
        side: 'SELL',
        positionSide: 'BOTH',
        price: '63000.00000000',
        qty: '0.00100000',
        quoteQty: '63.00000000',
        commission: '0.02500000',
        commissionAsset: 'USDT',
        realizedPnl: '-0.50000000',
        time: observedAt - 3_000,
        buyer: false,
        maker: true,
      }],
      coverage: coverage(),
    },
    reconciliation: {
      balances: partial('No independent balance invariant is computed.'),
      orders: partial('No independent order invariant is computed.'),
      fills: partial('Configured fill history remains symbol-scoped.'),
      positions: partial('No independent position invariant is computed.'),
      liabilities: partial('Open liabilities are not independently recomputed in BTC.'),
    },
  };
}

function decodedSnapshot(value = currentSnapshot()) {
  const decoded = decodePrivateReadSnapshot(value);
  assert.ok(decoded, 'fixture must pass the strict private-read decoder');
  return decoded;
}

function project(snapshot, overrides = {}) {
  const { now: suppliedNow, ...rest } = overrides;
  const now = suppliedNow
    ?? (snapshot.observedAt === null ? 1_720_000_005_000 : snapshot.observedAt + 5_000);
  return projectAccountTruth({
    snapshot,
    presentation: projectPrivateRead(snapshot, now),
    source: 'STATE',
    privateReadError: null,
    stateStatus: 'CURRENT',
    stateLastSuccessAtMs: snapshot.observedAt,
    stateError: null,
    now,
    ...rest,
  });
}

test('Account adapter preserves exact provider rows, units, ids, and family freshness', () => {
  const account = project(decodedSnapshot());

  assert.equal(account.wallets.rows.length, 3);
  assert.equal(account.wallets.rows[0].first, '12.50000000');
  assert.equal(account.wallets.rows[1].third, '2.00000000 / 0.01000000');
  assert.equal(account.orders.rows.length, 3);
  assert.deepEqual(account.orders.rows.map((row) => row.orderId), ['103', '102', '101']);
  assert.equal(account.fills.rows.length, 2);
  assert.equal(account.fills.rows.find((row) => row.product === 'USD-M')?.realizedPnl, '-0.50000000');
  assert.equal(account.positions.rows.length, 1);
  assert.equal(account.positions.rows[0].positionAmt, '0.00000000', 'provider position rows are not filtered into fake active exposure');
  assert.equal(account.positions.rows[0].leverage, null);
  assert.equal(account.positions.rows[0].marginType, null);
  assert.equal(account.orders.state, 'ALL_SOURCES_PRESENT');
  assert.equal(account.orders.allSourcesCurrent, true);
  assert.equal(account.freshnessFacts.length, 5);
  assert.deepEqual(
    account.freshnessFacts.slice(2).map((fact) => [fact.label, fact.freshnessLabel]),
    [['Spot', 'CURRENT'], ['Cross Margin', 'CURRENT'], ['USD-M', 'CURRENT']],
  );
  assert.match(account.freshnessFacts[2].coverageLabel, /Partial Symbol Scoped/);
});

test('available family rows remain visible while missing siblings stay explicitly unknown', () => {
  const fixture = currentSnapshot();
  fixture.margin.openOrders = null;
  fixture.margin.fills = null;
  const account = project(decodedSnapshot(fixture));

  assert.deepEqual(account.orders.rows.map((row) => row.product), ['USD-M', 'Spot']);
  assert.equal(account.orders.state, 'PARTIAL_SOURCES');
  assert.deepEqual(account.orders.missingProducts, ['Margin']);
  assert.equal(account.orders.exactEmptyCurrent, false);
  assert.match(account.orders.sourceLabel, /Margin Unavailable/);
  assert.deepEqual(account.fills.rows.map((row) => row.product), ['USD-M', 'Spot']);
  assert.equal(account.fills.state, 'PARTIAL_SOURCES');
  assert.equal(account.wallets.state, 'ALL_SOURCES_PRESENT');
});

test('current exact-empty arrays are distinct from stale retained emptiness', () => {
  const fixture = currentSnapshot();
  fixture.spot.openOrders = [];
  fixture.margin.openOrders = [];
  fixture.usdm.openOrders = [];
  fixture.spot.fills = [];
  fixture.margin.fills = [];
  fixture.usdm.fills = [];
  fixture.usdm.positions = [];
  const snapshot = decodedSnapshot(fixture);

  const current = project(snapshot);
  assert.equal(current.orders.rows.length, 0);
  assert.equal(current.orders.exactEmptyCurrent, true);
  assert.equal(current.orders.countLabel, '0 Orders');
  assert.equal(current.fills.exactEmptyCurrent, true);
  assert.equal(current.positions.exactEmptyCurrent, true);

  const retained = project(snapshot, {
    stateStatus: 'STALE',
    stateLastSuccessAtMs: snapshot.observedAt,
    stateError: 'transport detail must not render',
  });
  assert.equal(retained.retained, true);
  assert.equal(retained.orders.exactEmptyCurrent, false);
  assert.equal(retained.orders.countLabel, '—');
  assert.equal(retained.orders.rows.length, 0);
  assert.match(retained.sourceLabel, /Retained Account Truth/);
  assert.match(retained.sourceReason, /last admitted account rows are retained/i);
  assert.doesNotMatch(retained.sourceReason, /transport detail/i);
  assert.equal(retained.freshnessFacts[0].freshnessLabel, 'STALE · LAST-KNOWN ACCOUNT ROWS RETAINED');
  assert.equal(retained.stateLabel, 'Retained Last-Known');
  assert.equal(retained.freshnessLabel, 'Stale Last-Known Account Truth');
  assert.match(retained.freshnessFacts[1].stateLabel, /LAST-KNOWN/);
  assert.equal(retained.freshnessFacts[1].freshnessLabel, 'Stale Last-Known Account Truth');
  assert.doesNotMatch(retained.freshnessFacts[1].freshnessLabel, /Current/);
  assert.equal(retained.guardTone, 'warn');
});

test('unknown, future-dated, and failed reads never become current zero', () => {
  const unavailable = unavailablePrivateRead('PRIVATE_READ_PENDING');
  const pending = projectAccountTruth({
    snapshot: unavailable,
    presentation: projectPrivateRead(unavailable),
    source: 'PENDING',
    privateReadError: null,
    stateStatus: 'LOADING',
    stateLastSuccessAtMs: null,
    stateError: null,
    now: 1_720_000_005_000,
  });
  assert.equal(pending.orders.state, 'UNAVAILABLE');
  assert.equal(pending.orders.exactEmptyCurrent, false);
  assert.equal(pending.orders.countLabel, '—');
  assert.equal(pending.sourceClass, 'loading');

  const authFailure = projectAccountTruth({
    snapshot: unavailable,
    presentation: projectPrivateRead(unavailable),
    source: 'STATE',
    privateReadError: 'AUTH_REQUIRED_sensitive_detail',
    stateStatus: 'UNAVAILABLE',
    stateLastSuccessAtMs: null,
    stateError: 'must not render',
    now: 1_720_000_005_000,
  });
  assert.equal(authFailure.sourceClass, 'bad');
  assert.equal(authFailure.sourceReason, 'The authenticated account read was not admitted.');
  assert.doesNotMatch(authFailure.sourceReason, /sensitive|must not render/i);

  const futureFixture = currentSnapshot(1_720_000_100_000);
  futureFixture.spot.openOrders = [];
  futureFixture.margin.openOrders = [];
  futureFixture.usdm.openOrders = [];
  const future = decodedSnapshot(futureFixture);
  const futureAccount = project(future, { now: 1_720_000_000_000 });
  assert.equal(futureAccount.orders.allSourcesCurrent, false);
  assert.equal(futureAccount.orders.exactEmptyCurrent, false);
  assert.equal(futureAccount.freshnessFacts[2].freshnessLabel, 'UNKNOWN');

  const independentlyCurrentFamilies = currentSnapshot(1_720_000_200_000);
  independentlyCurrentFamilies.observedAt = 1_720_000_000_000;
  independentlyCurrentFamilies.spot.openOrders = [];
  independentlyCurrentFamilies.margin.openOrders = [];
  independentlyCurrentFamilies.usdm.openOrders = [];
  const staleRootAccount = project(decodedSnapshot(independentlyCurrentFamilies), {
    now: 1_720_000_205_000,
  });
  assert.equal(staleRootAccount.freshnessLabel, 'Stale Account Truth');
  assert.equal(staleRootAccount.orders.allSourcesCurrent, false);
  assert.equal(staleRootAccount.orders.exactEmptyCurrent, false);
  assert.equal(staleRootAccount.orders.countLabel, '—');
  assert.deepEqual(
    staleRootAccount.freshnessFacts.slice(2).map((fact) => fact.freshnessLabel),
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
  );

  const independentlyCurrentFamiliesFutureRoot = currentSnapshot(1_720_000_200_000);
  independentlyCurrentFamiliesFutureRoot.observedAt = 1_720_000_260_000;
  independentlyCurrentFamiliesFutureRoot.spot.openOrders = [];
  independentlyCurrentFamiliesFutureRoot.margin.openOrders = [];
  independentlyCurrentFamiliesFutureRoot.usdm.openOrders = [];
  const futureRootAccount = project(decodedSnapshot(independentlyCurrentFamiliesFutureRoot), {
    now: 1_720_000_205_000,
  });
  assert.equal(futureRootAccount.freshnessLabel, 'Freshness Unknown');
  assert.equal(futureRootAccount.orders.allSourcesCurrent, false);
  assert.equal(futureRootAccount.orders.exactEmptyCurrent, false);
  assert.equal(futureRootAccount.orders.countLabel, '—');
});

test('Account page consumes the shared authenticated cadence and adds no transport, actions, fake history, or fake money', async () => {
  const [page, adapter, store, privateRead] = await Promise.all([
    read('pages/Account.tsx'),
    read('pages/accountTruth.ts'),
    read('store.tsx'),
    read('lib/privateRead.ts'),
  ]);
  const accountSources = `${page}\n${adapter}`;

  for (const sharedFact of [
    'privateRead',
    'privateReadSource',
    'privateReadError',
    'stateStatus',
    'stateLastSuccessAtMs',
    'stateError',
  ]) assert.match(page, new RegExp(`\\b${sharedFact}\\b`));
  assert.match(page, /projectAccountTruth\(\{/);
  assert.match(page, /account\.freshnessFacts\.map/);
  assert.match(page, /account\.freshnessLabel/);
  assert.match(page, /account\.guardTone/);
  assert.match(page, /Retained Last-Known/);
  assert.match(page, /privateRead\.spot\.openOrders/);
  assert.doesNotMatch(accountSources, /\bfetch(?:Json)?\s*\(/);
  assert.doesNotMatch(accountSources, /\/api\/(?:state|private-account|apikey|refresh)/);
  assert.doesNotMatch(accountSources, /\bsetInterval\s*\(/);
  assert.doesNotMatch(page, /SpotBalanceChart|History Not Configured|const RANGES|historyPoints/);
  assert.doesNotMatch(page, /<button[^>]*>\s*(?:Trade|Cancel|Borrow|Repay|Transfer|Withdraw)/i);
  assert.match(page, /No cross-product valuation is published/);
  assert.match(page, /position\.marginType \?\? 'Margin Mode Not Published'/);
  assert.match(page, /position\.leverage === null/);

  assert.match(store, /fetchJson<ServerState>\('\/api\/state', \{ cache: 'no-store', signal: controller\.signal \}\)/);
  assert.match(store, /privateReadCadenceRef/);
  assert.match(store, /reduceRealDataClientTuple\(current, event\)/);
  assert.match(privateRead, /event\.requestId <= current\.privateRead\.appliedRequestId/);
  assert.match(store, /if \(trigger === 'DELTA'\) stateRefreshQueued = true/);
  assert.match(privateRead, /decoded \? 'STATE' : 'FALLBACK'/);
});
