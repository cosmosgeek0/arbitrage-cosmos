import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  decodeApiPermissionsEnvelope,
  decodePrivateReadSnapshot,
  exactOrDash,
  permissionPostureTone,
  projectPrivateRead,
  unavailablePrivateRead,
} from '../../src/lib/privateRead.ts';

const SOURCE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (relativePath) => readFile(join(SOURCE_ROOT, relativePath), 'utf8');

function reconciled(observedAt = 1_720_000_000_000) {
  return { state: 'RECONCILED', observedAt, reason: null };
}

function coverage() {
  return { state: 'COMPLETE_CURRENT', symbols: [], limitation: null };
}

function availableFixture() {
  const observedAt = 1_720_000_000_000;
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'AVAILABLE',
    observedAt,
    permissionPosture: {
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
    },
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
        leverage: '1',
        marginType: 'cross',
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
      balances: reconciled(observedAt),
      orders: reconciled(observedAt),
      fills: reconciled(observedAt),
      positions: reconciled(observedAt),
      liabilities: reconciled(observedAt),
    },
  };
}

function notConfiguredFixture() {
  const fact = () => ({ state: 'NOT_CONFIGURED', observedAt: null, reason: 'NOT_CONFIGURED' });
  const unavailableCoverage = () => ({ state: 'NOT_CONFIGURED', symbols: [], limitation: 'NOT_CONFIGURED' });
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'NOT_CONFIGURED',
    observedAt: null,
    permissionPosture: {
      state: 'NOT_CONFIGURED',
      observedAt: null,
      keyLabel: 'Binance Private Read',
      keyLast4: null,
      reading: null,
      spotMarginTrading: null,
      margin: null,
      futures: null,
      withdrawals: null,
      internalTransfer: null,
      universalTransfer: null,
      ipRestricted: null,
      fixTrade: null,
      portfolioMarginTrading: null,
    },
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

  const unavailable = unavailablePrivateRead('PRIVATE_READ_REQUEST_FAILED');
  const unavailableProjection = projectPrivateRead(unavailable);
  assert.equal(unavailableProjection.stateLabel, 'Unavailable');
  assert.equal(unavailableProjection.counts.spotBalances, null);
  assert.equal(unavailableProjection.counts.openOrders, null);
  assert.equal(unavailableProjection.counts.fills, null);
  assert.equal(unavailableProjection.counts.positions, null);
  assert.equal(exactOrDash(null), '—');
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
  partial.reconciliation.fills = {
    state: 'PARTIAL',
    observedAt: partial.observedAt,
    reason: 'SYMBOL_SCOPED_HISTORY',
  };
  const decodedPartial = decodePrivateReadSnapshot(partial);
  assert.ok(decodedPartial);
  assert.equal(projectPrivateRead(decodedPartial).tone, 'warn');
  assert.equal(projectPrivateRead(decodedPartial).coverageLabel, 'Partial Symbol-Scoped History');

  const decodedNotConfigured = decodePrivateReadSnapshot(notConfiguredFixture());
  assert.ok(decodedNotConfigured);
  const notConfiguredProjection = projectPrivateRead(decodedNotConfigured);
  assert.equal(notConfiguredProjection.stateLabel, 'Not Configured');
  assert.equal(notConfiguredProjection.tone, 'idle');
  assert.equal(notConfiguredProjection.postureTone, 'idle');
});

test('only a fully verified read-only permission posture can render green', () => {
  assert.equal(permissionPostureTone('VERIFIED_READ_ONLY'), 'ok');
  assert.equal(permissionPostureTone('UNSAFE'), 'bad');
  assert.equal(permissionPostureTone('UNKNOWN'), 'warn');
  assert.equal(permissionPostureTone('NOT_CONFIGURED'), 'idle');

  const unsafe = availableFixture();
  unsafe.state = 'UNAVAILABLE';
  unsafe.permissionPosture.state = 'UNSAFE';
  unsafe.permissionPosture.withdrawals = true;
  unsafe.spot = unavailablePrivateRead().spot;
  unsafe.margin = unavailablePrivateRead().margin;
  unsafe.usdm = unavailablePrivateRead().usdm;
  const decoded = decodePrivateReadSnapshot(unsafe);
  assert.ok(decoded);
  const projection = projectPrivateRead(decoded);
  assert.equal(projection.postureTone, 'bad');
  assert.equal(projection.permissionRows.some((row) => row.tone === 'ok'), false);
  assert.equal(projection.permissionRows.find((row) => row.id === 'withdrawals').tone, 'bad');
});

test('API permission envelope is exact and last-4 is the only key fragment presented', () => {
  const posture = availableFixture().permissionPosture;
  const decoded = decodeApiPermissionsEnvelope({
    schemaVersion: 'binance.api-permissions.v1',
    permissionPosture: posture,
  });
  assert.ok(decoded);
  const identity = projectPrivateRead(availableFixture()).identityLabel;
  assert.equal(identity, 'Binance Owner Read · Ending A1B2');
  assert.doesNotMatch(identity, /api[_-]?key|secret|signature|[A-Za-z0-9]{20,}/i);
  assert.equal(decodeApiPermissionsEnvelope({
    schemaVersion: 'binance.api-permissions.v1',
    permissionPosture: posture,
    extra: true,
  }), null);
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
  assert.match(store, /decodePrivateReadSnapshot\(snapshot\.privateRead\)/);
  assert.match(store, /privateReadSource !== 'FALLBACK'/);
  assert.match(store, /createSettledPoll<unknown>/);
  assert.match(owner, /'Reading'/);
  assert.match(owner, /'Spot \/ Margin Trading'/);
  assert.match(owner, /'Margin'/);
  assert.match(owner, /'Futures'/);
  assert.match(owner, /'Withdrawals'/);
  assert.match(owner, /'Transfers'/);
  assert.match(owner, /'IP Restriction'/);
  assert.match(styles, /\.api-permission-list\s*\{\s*grid-template-rows:\s*repeat\(7,/);
  assert.doesNotMatch(combined, /<button[^>]*>\s*(?:Trade|Cancel Order|Borrow|Repay|Transfer|Withdraw)/i);
  assert.doesNotMatch(combined, /clientOrderId|apiSecret|secretKey|signatureValue|whitelistContents/);
  assert.match(account, /No cross-product valuation is published/);
  assert.match(loans, /Borrowed And Accrued Interest Remain In Asset Units/);
  assert.match(health, /Private Account \{privatePresentation\.stateLabel\}/);
});
