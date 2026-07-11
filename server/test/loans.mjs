import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULTS } from '../dist/config.js';
import { Ledger } from '../dist/ledger.js';
import { LoanService } from '../dist/services/loans.js';

function config(overrides = {}) {
  const cfg = structuredClone(DEFAULTS);
  Object.assign(cfg, {
    killSwitch: false,
    fundsLocked: false,
    liveTradingEnabled: true,
    controlModes: {
      funds: 'allowed',
      borrowing: 'allowed',
      automation: 'allowed',
      liveOrders: 'allowed',
    },
    ...overrides,
  });
  cfg.borrowGuard = {
    ...cfg.borrowGuard,
    enabled: true,
    newBorrowPaused: false,
    repayOnly: false,
    maxLtvPct: 80,
    maxAprPct: 20,
    requireLiveCatalog: true,
    allowedCollateralCoins: ['USDT'],
    blockedLoanCoins: [],
    ...(overrides.borrowGuard ?? {}),
  };
  return cfg;
}

function ledger() {
  const events = [];
  return {
    events,
    logEvent(kind, symbol, data) {
      const event = { id: events.length + 1, ts: Date.now(), kind, symbol, data };
      events.push(event);
      return event;
    },
    lastEvent(kind) {
      return [...events].reverse().find((event) => event.kind === kind) ?? null;
    },
    unresolvedLoanMutations() {
      return events.filter((event) => event.kind === 'loan_request' && typeof event.data?.mutationId === 'string')
        .filter((request) => !events.some((response) => (
          response.id > request.id &&
          response.kind === 'loan_response' &&
          response.data?.mutationId === request.data.mutationId &&
          response.data?.outcome !== 'unknown'
        )))
        .map((request) => ({
          mutationId: request.data.mutationId,
          actionKey: request.data.actionKey,
          riskIncreasing: request.data.riskIncreasing === true,
        }));
    },
  };
}

function account(overrides = {}) {
  return {
    connected: true,
    lastSyncTs: Date.now(),
    keyRestrictions: {
      ipRestrict: true,
      enableReading: true,
      enableWithdrawals: false,
      enableInternalTransfer: false,
      enableMargin: true,
      enableSpotAndMarginTrading: true,
      enableFutures: false,
      permitsUniversalTransfer: false,
    },
    sync: async () => undefined,
    ...overrides,
  };
}

function client(overrides = {}) {
  const calls = {
    loanable: 0,
    collateral: 0,
    ongoing: 0,
    borrow: 0,
    adjust: 0,
    repay: 0,
    margin: 0,
  };
  const fake = {
    calls,
    async marginAccount() {
      calls.margin += 1;
      return {
        borrowEnabled: true,
        marginLevel: '4',
        totalAssetOfBtc: '1',
        totalLiabilityOfBtc: '0',
        totalNetAssetOfBtc: '1',
        userAssets: [],
      };
    },
    async marginInterestHistory() { return { rows: [] }; },
    async borrowRepayRecords() { return { rows: [] }; },
    async loanableData() {
      calls.loanable += 1;
      return {
        rows: [{
          loanCoin: 'BTC',
          flexibleInterestRate: '0.05',
          flexibleMinLimit: '10',
          flexibleMaxLimit: '100000',
        }],
      };
    },
    async collateralData() {
      calls.collateral += 1;
      return {
        rows: [{
          collateralCoin: 'USDT',
          initialLTV: '0.65',
          marginCallLTV: '0.75',
          liquidationLTV: '0.85',
          maxLimit: '100000',
        }],
      };
    },
    async ongoingLoans() {
      calls.ongoing += 1;
      return { rows: [] };
    },
    async flexibleBorrowHistory() { return { rows: [] }; },
    async flexibleRepayHistory() { return { rows: [] }; },
    async flexibleLtvAdjustmentHistory() { return { rows: [] }; },
    async flexibleBorrow() {
      calls.borrow += 1;
      return { status: 'Succeeds' };
    },
    async flexibleAdjustLtv() {
      calls.adjust += 1;
      return { status: 'Succeeds' };
    },
    async flexibleRepay() {
      calls.repay += 1;
      return { repayStatus: 'REPAID' };
    },
    async maxBorrowable() { return { amount: '1', borrowLimit: '1' }; },
    ...overrides,
  };
  return fake;
}

function service(fakeClient, cfg = config()) {
  return new LoanService(fakeClient, cfg, ledger(), account(), () => 10);
}

test('service boundary rejects non-canonical assets, directions, and non-finite amounts', async () => {
  const fake = client();
  const loans = service(fake);

  assert.equal((await loans.borrow('btc', 'USDT', 1, 'btc')).ok, false);
  assert.equal((await loans.borrow('BTC', 'USDT ', 1, 'BTC')).ok, false);
  assert.equal((await loans.borrow('BTC', 'USDT', Number.NaN, 'BTC')).ok, false);
  assert.equal((await loans.repay('BTC', 'USDT', Number.POSITIVE_INFINITY)).ok, false);
  assert.equal((await loans.adjustLtv('BTC', 'USDT', 1, 'REMOVE')).ok, false);
  assert.equal(fake.calls.borrow, 0);
  assert.equal(fake.calls.repay, 0);
  assert.equal(fake.calls.adjust, 0);
});

test('borrow rejects a catalog initial LTV at or above policy before signing', async () => {
  const fake = client({
    async collateralData() {
      fake.calls.collateral += 1;
      return { rows: [{ collateralCoin: 'USDT', initialLTV: '0.80', marginCallLTV: '0.85', liquidationLTV: '0.90', maxLimit: '100000' }] };
    },
  });
  const result = await service(fake).borrow('BTC', 'USDT', 1, 'BTC');

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /initial LTV/i);
  assert.equal(fake.calls.borrow, 0);
});

test('borrow fails closed for missing or ambiguous catalog LTV units', async () => {
  for (const initialLTV of [undefined, '65', 'NaN']) {
    const fake = client({
      async collateralData() {
        fake.calls.collateral += 1;
        return { rows: [{ collateralCoin: 'USDT', initialLTV, marginCallLTV: '0.75', liquidationLTV: '0.85', maxLimit: '100000' }] };
      },
    });
    const result = await service(fake).borrow('BTC', 'USDT', 1, 'BTC');
    assert.equal(result.ok, false, `initialLTV=${String(initialLTV)}`);
    assert.equal(fake.calls.borrow, 0, `initialLTV=${String(initialLTV)}`);
  }
});

test('borrow with exact pair and initial LTV below policy remains available', async () => {
  const fake = client();
  const result = await service(fake).borrow('BTC', 'USDT', 1, 'BTC');

  assert.deepEqual(result, { ok: true, status: 'succeeded' });
  assert.equal(fake.calls.borrow, 1);
});

test('REDUCED collateral rejects projected post-change LTV above policy', async () => {
  const fake = client({
    async ongoingLoans() {
      fake.calls.ongoing += 1;
      return { rows: [{ loanCoin: 'BTC', collateralCoin: 'USDT', totalDebt: '100', collateralAmount: '100', currentLTV: '0.60' }] };
    },
  });
  const result = await service(fake).adjustLtv('BTC', 'USDT', 30, 'REDUCED', 'BTC');

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /projected LTV/i);
  assert.equal(fake.calls.adjust, 0);
});

test('REDUCED collateral below policy remains available with fresh exact-pair state', async () => {
  const fake = client({
    async ongoingLoans() {
      fake.calls.ongoing += 1;
      return { rows: [{ loanCoin: 'BTC', collateralCoin: 'USDT', totalDebt: '100', collateralAmount: '100', currentLTV: '0.60' }] };
    },
  });
  const result = await service(fake).adjustLtv('BTC', 'USDT', 10, 'REDUCED', 'BTC');

  assert.deepEqual(result, { ok: true, status: 'succeeded' });
  assert.equal(fake.calls.adjust, 1);
  assert.equal(fake.calls.ongoing, 1);
});

test('REDUCED fails closed on missing/non-finite state while ADDITIONAL remains available', async () => {
  const fake = client({
    async ongoingLoans() {
      fake.calls.ongoing += 1;
      throw new Error('read unavailable');
    },
  });
  const loans = service(fake);

  const reduced = await loans.adjustLtv('BTC', 'USDT', 1, 'REDUCED', 'BTC');
  assert.equal(reduced.ok, false);
  assert.match(reduced.error ?? '', /live loan state unavailable/i);
  assert.equal(fake.calls.adjust, 0);

  const additional = await loans.adjustLtv('BTC', 'USDT', 1, 'ADDITIONAL', 'BTC');
  assert.deepEqual(additional, { ok: true, status: 'succeeded' });
  assert.equal(fake.calls.adjust, 1);
});

test('concurrent reductions serialize and refresh state before each signed call', async () => {
  let collateral = 100;
  let currentLtv = 0.50;
  const fake = client({
    async ongoingLoans() {
      fake.calls.ongoing += 1;
      return { rows: [{
        loanCoin: 'BTC',
        collateralCoin: 'USDT',
        totalDebt: '100',
        collateralAmount: String(collateral),
        currentLTV: String(currentLtv),
      }] };
    },
    async flexibleAdjustLtv(_loan, _collateral, amount) {
      fake.calls.adjust += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      currentLtv = currentLtv * collateral / (collateral - amount);
      collateral -= amount;
      return { status: 'Succeeds' };
    },
  });
  const loans = service(fake);
  const [first, second] = await Promise.all([
    loans.adjustLtv('BTC', 'USDT', 30, 'REDUCED', 'BTC'),
    loans.adjustLtv('BTC', 'USDT', 30, 'REDUCED', 'BTC'),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error ?? '', /projected LTV/i);
  assert.equal(fake.calls.adjust, 1);
  assert.equal(fake.calls.ongoing, 2);
});

test('concurrent forced snapshots are single-flight and bounded', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const fake = client({
    async loanableData() {
      fake.calls.loanable += 1;
      await wait;
      return { rows: Array.from({ length: 2_500 }, (_, i) => ({
        loanCoin: `A${i}`,
        flexibleInterestRate: '0.01',
        flexibleMinLimit: '1',
        flexibleMaxLimit: '2',
      })) };
    },
  });
  const loans = service(fake);
  const first = loans.snapshot(true);
  const second = loans.snapshot(true);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(fake.calls.loanable, 1);
  assert.equal(fake.calls.margin, 1);
  assert.ok(a.loanable.length <= 2_000);
  assert.equal(a.available, false, 'oversized catalogs are rejected rather than truncated into false completeness');
  assert.match(a.error ?? '', /2,?000-row safety cap/i);
  assert.equal(a.fetchedAt, b.fetchedAt);
});

test('margin refresh failure retains the last successful debt snapshot as stale', async () => {
  let shouldFail = false;
  const fake = client({
    async marginAccount() {
      fake.calls.margin += 1;
      if (shouldFail) throw new Error('transient margin outage');
      return {
        borrowEnabled: true,
        marginLevel: '2.5',
        totalAssetOfBtc: '1.5',
        totalLiabilityOfBtc: '0.5',
        totalNetAssetOfBtc: '1',
        userAssets: [{
          asset: 'BTC',
          free: '0.1',
          locked: '0',
          borrowed: '0.02',
          interest: '0.001',
          netAsset: '0.079',
        }],
      };
    },
  });
  const loans = service(fake);
  const current = await loans.marginSnapshot(true);

  assert.equal(current.available, true);
  assert.equal(current.stale, false);
  assert.equal(current.error, null);
  assert.ok(current.attemptedAt <= current.fetchedAt);
  assert.equal(current.assets.length, 1);
  assert.equal(current.assets[0].borrowed, 0.02);

  shouldFail = true;
  const stale = await loans.marginSnapshot(true);

  assert.equal(stale.available, false);
  assert.equal(stale.stale, true);
  assert.match(stale.error ?? '', /transient margin outage/i);
  assert.equal(stale.fetchedAt, current.fetchedAt);
  assert.ok(stale.attemptedAt >= current.attemptedAt);
  assert.deepEqual(stale.assets, current.assets);
  assert.equal(stale.totalLiabilityBtc, current.totalLiabilityBtc);
  assert.equal(fake.calls.margin, 2);
});

test('ambiguous signed responses require reconciliation instead of reporting success', async () => {
  const fake = client({
    async flexibleBorrow() {
      fake.calls.borrow += 1;
      return { status: 'Processing' };
    },
  });
  const result = await service(fake).borrow('BTC', 'USDT', 1, 'BTC');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reconciliationRequired, true);
  assert.match(result.error ?? '', /reconciliation/i);
});

test('transport failures after a signed attempt remain unknown until reconciliation', async () => {
  const fake = client({
    async flexibleRepay() {
      fake.calls.repay += 1;
      throw new Error('socket closed after upload');
    },
  });
  const result = await service(fake).repay('BTC', 'USDT', 1, 'BTC');

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reconciliationRequired, true);
  assert.match(result.error ?? '', /reconciliation/i);
});

test('unresolved signed outcome persistently blocks a repeated money action', async () => {
  const fake = client({
    async flexibleBorrow() {
      fake.calls.borrow += 1;
      throw new Error('socket closed after upload');
    },
  });
  const store = ledger();
  const loans = new LoanService(fake, config(), store, account(), () => 10);
  const first = await loans.borrow('BTC', 'USDT', 1, 'BTC');
  const second = await loans.borrow('BTC', 'USDT', 1, 'BTC');
  assert.equal(first.status, 'unknown');
  assert.equal(second.ok, false);
  assert.match(second.error ?? '', /prior loan action.*unresolved/i);
  assert.equal(fake.calls.borrow, 1);

  assert.equal(loans.acknowledgeReconciliation('wrong').ok, false);
  assert.equal(loans.acknowledgeReconciliation('BINANCE LOAN STATE VERIFIED').ok, true);
});

test('money actions require live arm, allowed controls, and safe key posture', async () => {
  const fake = client();
  const disarmed = config({
    liveTradingEnabled: false,
    controlModes: { funds: 'allowed', borrowing: 'allowed', automation: 'paused', liveOrders: 'paused' },
  });
  const blocked = await new LoanService(fake, disarmed, ledger(), account(), () => 10)
    .borrow('BTC', 'USDT', 1, 'BTC');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? '', /not armed/i);
  assert.equal(fake.calls.borrow, 0);

  const unsafeAccount = account({
    keyRestrictions: { ...account().keyRestrictions, enableWithdrawals: true },
  });
  const unsafe = await new LoanService(fake, config(), ledger(), unsafeAccount, () => 10)
    .repay('BTC', 'USDT', 1, 'BTC');
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error ?? '', /withdrawals enabled/i);
  assert.equal(fake.calls.repay, 0);
});

test('borrow valuation enforces Binance USD limits and the deliberate app cap', async () => {
  const fake = client();
  const capped = config({ borrowGuard: { ...config().borrowGuard, maxBorrowNotionalUsd: 9 } });
  const result = await new LoanService(fake, capped, ledger(), account(), () => 10)
    .borrow('BTC', 'USDT', 1, 'BTC');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /app loan cap/i);
  assert.equal(fake.calls.borrow, 0);
});

test('collateral reduction obeys exchange margin-call buffer even when app limit is looser', async () => {
  const fake = client({
    async ongoingLoans() {
      fake.calls.ongoing += 1;
      return { rows: [{ loanCoin: 'BTC', collateralCoin: 'USDT', totalDebt: '100', collateralAmount: '100', currentLTV: '0.60' }] };
    },
  });
  const loose = config({ borrowGuard: { ...config().borrowGuard, maxLtvPct: 90 } });
  const result = await new LoanService(fake, loose, ledger(), account(), () => 10)
    .adjustLtv('BTC', 'USDT', 20, 'REDUCED', 'BTC');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /safe limit/i);
  assert.equal(fake.calls.adjust, 0);
});

test('margin history failure retains the complete prior snapshot instead of publishing empty history', async () => {
  let historyFails = false;
  const fake = client({
    async marginInterestHistory() {
      if (historyFails) throw new Error('interest history unavailable');
      return { rows: [{ asset: 'BTC', interest: '0.001', interestRate: '0.0001', interestAccuredTime: Date.now() }] };
    },
  });
  const loans = service(fake);
  const current = await loans.marginSnapshot(true);
  assert.equal(current.available, true);
  assert.equal(current.interestHistory.length, 1);

  historyFails = true;
  const stale = await loans.marginSnapshot(true);
  assert.equal(stale.available, false);
  assert.equal(stale.stale, true);
  assert.match(stale.error ?? '', /interest history unavailable/i);
  assert.deepEqual(stale.interestHistory, current.interestHistory);
  assert.equal(stale.fetchedAt, current.fetchedAt);
});

test('malformed margin totals fail closed and retain the last complete snapshot', async () => {
  let malformed = false;
  const fake = client({
    async marginAccount() {
      fake.calls.margin += 1;
      return {
        borrowEnabled: true,
        marginLevel: malformed ? 'not-a-number' : '4',
        totalAssetOfBtc: '1',
        totalLiabilityOfBtc: '0',
        totalNetAssetOfBtc: '1',
        userAssets: [],
      };
    },
  });
  const loans = service(fake);
  const current = await loans.marginSnapshot(true);
  malformed = true;
  const stale = await loans.marginSnapshot(true);

  assert.equal(current.available, true);
  assert.equal(stale.available, false);
  assert.equal(stale.stale, true);
  assert.match(stale.error ?? '', /malformed margin account totals/i);
  assert.equal(stale.marginLevel, current.marginLevel);
  assert.equal(stale.fetchedAt, current.fetchedAt);
});

test('flexible history failure retains the prior complete loan snapshot', async () => {
  let historyFails = false;
  const fake = client({
    async flexibleRepayHistory() {
      if (historyFails) throw new Error('repay history unavailable');
      return { rows: [] };
    },
  });
  const loans = service(fake);
  const current = await loans.snapshot(true);
  assert.equal(current.available, true);

  historyFails = true;
  const stale = await loans.snapshot(true);
  assert.equal(stale.available, false);
  assert.match(stale.error ?? '', /repay history unavailable/i);
  assert.equal(stale.fetchedAt, current.fetchedAt);
  assert.deepEqual(stale.loanable, current.loanable);
});

test('only USDT is hard-pegged; other stablecoins require a live market price', async () => {
  const fake = client({
    async loanableData() {
      fake.calls.loanable += 1;
      return { rows: [{ loanCoin: 'USDC', flexibleInterestRate: '0.05', flexibleMinLimit: '1', flexibleMaxLimit: '100000' }] };
    },
  });
  const missingPrice = await new LoanService(fake, config(), ledger(), account(), () => null)
    .borrow('USDC', 'USDT', 10, 'USDC');
  assert.equal(missingPrice.ok, false);
  assert.match(missingPrice.error ?? '', /fresh USDCUSDT valuation is unavailable/i);
  assert.equal(fake.calls.borrow, 0);

  const pricedFake = client({
    async loanableData() {
      pricedFake.calls.loanable += 1;
      return { rows: [{ loanCoin: 'USDC', flexibleInterestRate: '0.05', flexibleMinLimit: '1', flexibleMaxLimit: '100000' }] };
    },
  });
  const priced = await new LoanService(pricedFake, config(), ledger(), account(), (symbol) => symbol === 'USDCUSDT' ? 0.99 : null)
    .borrow('USDC', 'USDT', 10, 'USDC');
  assert.deepEqual(priced, { ok: true, status: 'succeeded' });
  assert.equal(pricedFake.calls.borrow, 1);
});

test('successful and ambiguous signed attempts invalidate cached state even when audit commit fails', async () => {
  const successFake = client();
  const successStore = ledger();
  const successLog = successStore.logEvent.bind(successStore);
  successStore.logEvent = (kind, symbol, data) => {
    if (kind === 'loan_response') throw new Error('audit disk unavailable');
    return successLog(kind, symbol, data);
  };
  const successLoans = new LoanService(successFake, config(), successStore, account(), () => 10);
  await successLoans.snapshot(true);
  const successResult = await successLoans.borrow('BTC', 'USDT', 1, 'BTC');
  assert.equal(successResult.status, 'unknown');
  assert.equal(successResult.reconciliationRequired, true);
  await successLoans.snapshot(false);
  assert.equal(successFake.calls.loanable, 3, 'snapshot + signed preflight + post-attempt refresh');

  const ambiguousFake = client({
    async flexibleRepay() {
      ambiguousFake.calls.repay += 1;
      throw new Error('socket closed after upload');
    },
  });
  const ambiguousStore = ledger();
  const ambiguousLog = ambiguousStore.logEvent.bind(ambiguousStore);
  ambiguousStore.logEvent = (kind, symbol, data) => {
    if (kind === 'loan_response') throw new Error('audit disk unavailable');
    return ambiguousLog(kind, symbol, data);
  };
  const ambiguousLoans = new LoanService(ambiguousFake, config(), ambiguousStore, account(), () => 10);
  await ambiguousLoans.snapshot(true);
  const ambiguousResult = await ambiguousLoans.repay('BTC', 'USDT', 1, 'BTC');
  assert.equal(ambiguousResult.status, 'unknown');
  assert.equal(ambiguousResult.reconciliationRequired, true);
  await ambiguousLoans.snapshot(false);
  assert.equal(ambiguousFake.calls.loanable, 2, 'snapshot is reloaded after an ambiguous signed attempt');
});

test('unresolved loan mutation scan has no first-100 blind spot', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-loan-ledger-'));
  const store = new Ledger(dataDir);
  try {
    for (let index = 0; index < 125; index += 1) {
      store.logEvent('loan_request', null, {
        mutationId: `mutation-${index}`,
        actionKey: `borrow:ASSET${index}:USDT`,
        riskIncreasing: true,
      });
    }
    assert.equal(store.unresolvedLoanMutations().length, 125);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
