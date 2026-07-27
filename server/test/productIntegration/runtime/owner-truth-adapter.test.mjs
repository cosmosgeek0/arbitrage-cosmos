import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductRuntimeSupervisorEnvelope,
  projectProductMaterialEventPage,
  projectProductRuntimeOwnerTruthCut,
} from '../../../dist/productIntegration/runtime/index.js';
import {
  PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS,
  PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
} from '../../../dist/productIntegration/runtime/types.js';
import {
  T0,
  makeOpsInterlock,
  makeOpsReadback,
  makeRead,
  makeSupervisor,
} from './testSupport.mjs';

const ACCOUNT_FIELDS = Object.freeze([
  'spot-truth', 'usdm-truth', 'margin-truth', 'balances-equity-collateral',
  'available-capital', 'permissions-modes', 'orders-positions',
  'liabilities-interest', 'freshness-completeness', 'reconciliation',
  'foreign-manual',
]);
const MARKETS_FIELDS = Object.freeze([
  'basis', 'wake-up', 'flow', 'liquidity', 'derivatives', 'data-quality',
  'candidate-focus', 'source-freshness', 'q-assessment',
]);

function supervisorWithAvailableCapital() {
  const source = makeSupervisor();
  return makeSupervisor({
    summaries: Object.freeze({
      ...source.summaries,
      capital: Object.freeze({
        ...source.summaries.capital,
        allocatableAmount: '250.00000000 USDT',
      }),
    }),
  });
}

function reconciliation(state = 'RECONCILED', observedAt = T0 - 50) {
  return Object.freeze({
    balances: Object.freeze({ state, observedAt, reason: null }),
    orders: Object.freeze({ state, observedAt, reason: null }),
    fills: Object.freeze({
      state: 'PARTIAL',
      observedAt,
      reason: 'Trade history is symbol-scoped.',
    }),
    positions: Object.freeze({ state, observedAt, reason: null }),
    liabilities: Object.freeze({ state, observedAt, reason: null }),
  });
}

function availablePrivateRead() {
  const coverage = Object.freeze({
    state: 'COMPLETE_CURRENT',
    symbols: Object.freeze(['BTCUSDT']),
    limitation: null,
  });
  return Object.freeze({
    schemaVersion: 'binance.private-read.v1',
    state: 'AVAILABLE',
    observedAt: T0 - 50,
    permissionPosture: Object.freeze({
      state: 'VERIFIED_READ_ONLY',
      observedAt: T0 - 70,
      keyLabel: 'Binance Read Only',
      keyLast4: null,
      reading: true,
      spotMarginTrading: false,
      margin: true,
      futures: true,
      withdrawals: false,
      internalTransfer: false,
      universalTransfer: false,
      ipRestricted: true,
      vanillaOptions: false,
      fixTrade: false,
      fixReadOnly: true,
      portfolioMarginTrading: false,
    }),
    spot: Object.freeze({
      state: 'AVAILABLE',
      observedAt: T0 - 50,
      balances: Object.freeze([
        Object.freeze({ asset: 'USDT', free: '123.45000000', locked: '0.00000000' }),
      ]),
      openOrders: Object.freeze([
        Object.freeze({
          symbol: 'BTCUSDT',
          orderId: '42',
          side: 'BUY',
          type: 'LIMIT',
          price: '62000.00000000',
          origQty: '0.01000000',
          executedQty: '0.00000000',
          status: 'NEW',
          time: T0 - 1_000,
        }),
      ]),
      fills: Object.freeze([]),
      coverage,
    }),
    margin: Object.freeze({
      state: 'AVAILABLE',
      observedAt: T0 - 50,
      totalAssetBtc: '1.25000000',
      totalLiabilityBtc: '0.12500000',
      totalNetAssetBtc: '1.12500000',
      assets: Object.freeze([
        Object.freeze({
          asset: 'USDT',
          free: '20.00000000',
          locked: '0.00000000',
          borrowed: '2.50000000',
          interest: '0.01000000',
          netAsset: '17.49000000',
        }),
      ]),
      openOrders: Object.freeze([]),
      fills: Object.freeze([]),
      coverage,
    }),
    usdm: Object.freeze({
      state: 'AVAILABLE',
      observedAt: T0 - 50,
      balances: Object.freeze([
        Object.freeze({
          asset: 'USDT',
          balance: '55.25000000',
          availableBalance: '44.50000000',
          crossWalletBalance: '50.00000000',
          crossUnPnl: '5.25000000',
        }),
      ]),
      positions: Object.freeze([
        Object.freeze({
          symbol: 'BTCUSDT',
          positionSide: 'BOTH',
          positionAmt: '-0.01000000',
          entryPrice: '63000.00000000',
          markPrice: '62000.00000000',
          unRealizedProfit: '10.00000000',
          liquidationPrice: '0.00000000',
          leverage: null,
          marginType: null,
          isolatedMargin: '0.00000000',
          notional: '-620.00000000',
          updateTime: T0 - 100,
        }),
      ]),
      openOrders: Object.freeze([]),
      fills: Object.freeze([]),
      coverage,
    }),
    reconciliation: reconciliation(),
  });
}

function notConfiguredPrivateRead() {
  const unavailableCoverage = Object.freeze({
    state: 'NOT_CONFIGURED',
    symbols: Object.freeze([]),
    limitation: 'Private Binance credentials are not configured.',
  });
  const unavailableProduct = Object.freeze({
    state: 'NOT_CONFIGURED',
    observedAt: null,
    balances: null,
    openOrders: null,
    fills: null,
    coverage: unavailableCoverage,
  });
  return Object.freeze({
    schemaVersion: 'binance.private-read.v1',
    state: 'NOT_CONFIGURED',
    observedAt: null,
    permissionPosture: Object.freeze({
      state: 'NOT_CONFIGURED',
      observedAt: null,
      keyLabel: 'Binance Read Only',
      keyLast4: null,
      reading: null,
      spotMarginTrading: null,
      margin: null,
      futures: null,
      withdrawals: null,
      internalTransfer: null,
      universalTransfer: null,
      ipRestricted: null,
      vanillaOptions: null,
      fixTrade: null,
      fixReadOnly: null,
      portfolioMarginTrading: null,
    }),
    spot: unavailableProduct,
    margin: Object.freeze({
      ...unavailableProduct,
      totalAssetBtc: null,
      totalLiabilityBtc: null,
      totalNetAssetBtc: null,
      assets: null,
    }),
    usdm: Object.freeze({ ...unavailableProduct, positions: null }),
    reconciliation: Object.freeze(Object.fromEntries(
      ['balances', 'orders', 'fills', 'positions', 'liabilities'].map((field) => [
        field,
        Object.freeze({ state: 'NOT_CONFIGURED', observedAt: null, reason: null }),
      ]),
    )),
  });
}

function availableMarkets(overrides = {}) {
  return Object.freeze({
    observedAtMs: T0 - 25,
    dataSources: Object.freeze({
      spotBookTicker: 'fresh',
      futuresBookTicker: 'fresh',
      futures24hTicker: 'fresh',
    }),
    rows: Object.freeze([
      Object.freeze({
        symbol: 'BTCUSDT',
        basisPct: 'not-a-number',
        executableBasisBestPct: 0.42,
        executableBasisSide: 'LONG_SPOT_SHORT_PERP',
        change24hPct: -1.25,
        quoteVolume24h: 987654321.25,
        spotSpreadPct: 0.001,
        spotTopQuoteUsd: 250000,
        perpSpreadPct: 0.002,
        perpTopQuoteUsd: 210000,
        fundingRate: 0.0001,
        fundingAnnualPct: 10.95,
        openInterestUsd: 2500000000,
        oiToPerpVolume24h: 2.53,
        liquidations15mUsd: 125000,
        longLiquidations15mUsd: 100000,
        shortLiquidations15mUsd: 25000,
      }),
      Object.freeze({
        symbol: 'ETHUSDT',
        basisPct: 0.55,
        executableBasisBestPct: -0.81,
        executableBasisSide: 'SHORT_SPOT_LONG_PERP',
        change24hPct: 2.1,
        quoteVolume24h: 456789123.5,
      }),
    ]),
    ...overrides,
  });
}

function fields(surface) {
  const rows = Array.isArray(surface.fields) ? surface.fields : surface.evidence;
  return Object.fromEntries(rows.map((field) => [field.fieldId, field]));
}

function surface(cut, surfaceId) {
  return cut.surfaces.find((candidate) => candidate.surfaceId === surfaceId);
}

test('available injected cuts bind every owned row to exact source facts or a specific non-green reason', () => {
  const supervisor = supervisorWithAvailableCapital();
  const cut = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead: availablePrivateRead(),
    markets: availableMarkets(),
  });

  assert.equal(cut.schemaVersion, PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA);
  assert.equal(cut.source, 'server.ownerTruth');
  assert.equal(cut.observedAtMs, T0 - 25);
  assert.deepEqual(cut.surfaces.map((candidate) => candidate.surfaceId), [
    'dashboard',
    'account',
    'markets',
  ]);

  for (const candidate of cut.surfaces) {
    assert.deepEqual(
      candidate.fields.map((field) => field.fieldId),
      [...PRODUCT_RUNTIME_OWNER_TRUTH_FIELDS[candidate.surfaceId]],
    );
    for (const field of candidate.fields) {
      if (field.value !== null) {
        assert.ok(field.value.length > 0 && field.value.length <= 240);
        assert.equal(field.unavailableReason, null);
      } else {
        assert.match(field.unavailableReason, /^[A-Z][A-Z0-9_]{0,63}$/);
        assert.notEqual(field.unavailableReason, 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED');
      }
      assert.match(field.source, /^(systemIntegration\.supervisor|services\.privateRead|intelligenceRuntime\.marketSources)$/);
    }
  }

  const dashboard = fields(surface(cut, 'dashboard'));
  assert.match(dashboard['pipeline-counts'].value, /basisCandidates=1/);
  assert.match(dashboard['active-objects'].value, /activeExposures=0/);
  assert.equal(dashboard['pnl-drawdown'].source, 'services.privateRead');
  assert.equal(dashboard['pnl-drawdown'].unavailableReason, 'PNL_DRAWDOWN_NOT_PUBLISHED');
  assert.equal(
    dashboard['strategy-q'].unavailableReason,
    'STRATEGY_Q_ASSESSMENT_NOT_PUBLISHED',
  );

  const accountSurface = surface(cut, 'account');
  const account = fields(accountSurface);
  assert.equal(accountSurface.source, 'services.privateRead');
  assert.equal(
    accountSurface.supersedesCanonicalAccountTruthState,
    supervisor.summaries.capital.accountTruthState,
  );
  assert.match(account['spot-truth'].value, /free=123\.45000000:locked=0\.00000000/);
  assert.match(account['usdm-truth'].value, /balance=55\.25000000:available=44\.50000000/);
  assert.match(account['margin-truth'].value, /totalNetAssetBtc=1\.12500000/);
  assert.match(account['liabilities-interest'].value, /borrowed=2\.50000000:interest=0\.01000000/);
  assert.match(account['available-capital'].value, /allocatableAmount=250\.00000000 USDT/);
  assert.equal(account['available-capital'].source, 'systemIntegration.supervisor');
  assert.equal(
    account['balances-equity-collateral'].unavailableReason,
    'EQUITY_COLLATERAL_VALUATION_NOT_PUBLISHED',
  );
  assert.equal(
    account['foreign-manual'].unavailableReason,
    'FOREIGN_MANUAL_PROVENANCE_NOT_PUBLISHED',
  );

  const markets = fields(surface(cut, 'markets'));
  assert.match(markets.basis.value, /symbol=ETHUSDT/);
  assert.match(markets.basis.value, /executableBasisBestPct=-0\.81/);
  assert.match(markets.liquidity.value, /spotTopQuoteUsd=250000/);
  assert.match(markets.derivatives.value, /fundingRate=0\.0001/);
  assert.match(markets['source-freshness'].value, /futures24hTicker=fresh/);
  assert.equal(
    markets['wake-up'].unavailableReason,
    'MARKET_WAKE_UP_SEMANTICS_NOT_PUBLISHED',
  );
  assert.equal(
    markets.flow.unavailableReason,
    'MARKET_FLOW_SEMANTICS_NOT_PUBLISHED',
  );
  assert.equal(
    markets['candidate-focus'].unavailableReason,
    'MARKET_CANDIDATE_FOCUS_NOT_PUBLISHED',
  );
  assert.equal(
    markets['q-assessment'].unavailableReason,
    'MARKET_Q_ASSESSMENT_NOT_PUBLISHED',
  );

  assert.equal(JSON.stringify(cut).includes('CANONICAL_OWNER_FIELD_NOT_CONFIGURED'), false);
  assert.ok(Object.isFrozen(cut));
  assert.ok(Object.isFrozen(cut.surfaces));
});

test('keyless private truth remains explicitly not configured while public Markets stays source bound', () => {
  const cut = projectProductRuntimeOwnerTruthCut({
    supervisor: makeSupervisor(),
    privateRead: notConfiguredPrivateRead(),
    markets: availableMarkets(),
  });
  const account = surface(cut, 'account');
  assert.equal(account.state, 'UNAVAILABLE');
  assert.equal(account.truthLabel, 'NOT_CONFIGURED');
  assert.equal(account.unavailableReason, 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED');
  assert.equal(account.source, 'services.privateRead');
  assert.deepEqual(account.fields, []);
  assert.equal(account.supersedesCanonicalAccountTruthState, null);

  const markets = surface(cut, 'markets');
  assert.equal(markets.state, 'AVAILABLE');
  assert.equal(fields(markets).basis.state, 'AVAILABLE');
  assert.equal(JSON.stringify(cut).includes('CANONICAL_OWNER_FIELD_NOT_CONFIGURED'), false);
});

test('partial source cuts preserve the facts that arrived and block only unavailable semantics', () => {
  const current = availablePrivateRead();
  const partialPrivate = Object.freeze({
    ...current,
    state: 'PARTIAL',
    margin: Object.freeze({
      ...current.margin,
      state: 'UNAVAILABLE',
      observedAt: null,
      totalAssetBtc: null,
      totalLiabilityBtc: null,
      totalNetAssetBtc: null,
      assets: null,
      openOrders: null,
      fills: null,
    }),
    reconciliation: reconciliation('PARTIAL'),
  });
  const partialMarkets = availableMarkets({
    dataSources: Object.freeze({
      spotBookTicker: 'fresh',
      futuresBookTicker: 'unavailable',
      futures24hTicker: 'unavailable',
    }),
  });
  const cut = projectProductRuntimeOwnerTruthCut({
    supervisor: makeSupervisor(),
    privateRead: partialPrivate,
    markets: partialMarkets,
  });
  const account = fields(surface(cut, 'account'));
  assert.equal(account['spot-truth'].state, 'AVAILABLE');
  assert.match(account['spot-truth'].value, /free=123\.45000000/);
  assert.equal(account['margin-truth'].state, 'UNAVAILABLE');
  assert.equal(account['margin-truth'].unavailableReason, 'MARGIN_PRIVATE_READ_UNAVAILABLE');
  assert.equal(
    account['freshness-completeness'].unavailableReason,
    'PRIVATE_ACCOUNT_FRESHNESS_OR_COVERAGE_PARTIAL',
  );
  assert.equal(
    account.reconciliation.unavailableReason,
    'PRIVATE_ACCOUNT_RECONCILIATION_INCOMPLETE',
  );

  const markets = fields(surface(cut, 'markets'));
  assert.equal(markets['source-freshness'].state, 'UNAVAILABLE');
  assert.equal(markets['source-freshness'].unavailableReason, 'MARKET_PUBLIC_SOURCES_PARTIAL');
  assert.equal(markets['data-quality'].state, 'AVAILABLE');
  assert.match(markets['data-quality'].value, /futuresBookTicker=unavailable/);
  assert.equal(markets.flow.unavailableReason, 'MARKET_FLOW_SEMANTICS_NOT_PUBLISHED');
});

test('large input arrays and invalid numeric values stay bounded without inventing replacements', () => {
  const current = availablePrivateRead();
  const manyBalances = Object.freeze(Array.from({ length: 200 }, () => current.spot.balances[0]));
  const privateRead = Object.freeze({
    ...current,
    spot: Object.freeze({ ...current.spot, balances: manyBalances }),
  });
  const rows = Object.freeze(Array.from({ length: 140 }, (_, index) => Object.freeze({
    symbol: `A${String(index).padStart(3, '0')}USDT`,
    executableBasisBestPct: index === 0 ? Number.POSITIVE_INFINITY : index / 100,
    quoteVolume24h: index === 1 ? Number.NaN : index * 1_000,
  })));
  const cut = projectProductRuntimeOwnerTruthCut({
    supervisor: makeSupervisor(),
    privateRead,
    markets: availableMarkets({ rows }),
  });
  const account = fields(surface(cut, 'account'));
  assert.match(account['spot-truth'].value, /balances=200/);
  assert.match(account['spot-truth'].value, /free=123\.45000000/);

  const markets = fields(surface(cut, 'markets'));
  assert.match(markets['data-quality'].value, /rowsReceived=140/);
  assert.match(markets['data-quality'].value, /rowsBounded=128/);
  assert.match(markets['data-quality'].value, /truncated=YES/);
  assert.equal(markets.basis.value.includes('Infinity'), false);
  for (const candidate of cut.surfaces) {
    for (const field of candidate.fields) {
      if (field.value !== null) assert.ok(field.value.length <= 240);
    }
  }
});

test('production cuts bind through the final envelope with exact inventories and no generic missing reason', () => {
  const supervisor = supervisorWithAvailableCapital();
  const availableCut = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead: availablePrivateRead(),
    markets: availableMarkets(),
  });
  const materialEvents = projectProductMaterialEventPage(
    '0',
    10,
    makeRead().events({ afterCursor: '0', limit: 10 }),
  );
  const envelope = buildProductRuntimeSupervisorEnvelope({
    applicationStartOk: true,
    snapshot: supervisor,
    opsReadback: makeOpsReadback(),
    opsIntakeInterlock: makeOpsInterlock(),
    materialEvents,
    traces: [],
    ownerTruthCut: availableCut,
    ownerTruthUnavailableReason: null,
    nowMs: T0,
  });
  assert.deepEqual(envelope.surfaces.account.evidence.map((field) => field.fieldId), ACCOUNT_FIELDS);
  assert.deepEqual(envelope.surfaces.markets.evidence.map((field) => field.fieldId), MARKETS_FIELDS);
  for (const surfaceId of ['dashboard', 'account', 'markets']) {
    for (const field of envelope.surfaces[surfaceId].evidence) {
      assert.notEqual(field.unavailableReason, 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED');
    }
  }
  assert.equal(
    fields(envelope.surfaces.account)['balances-equity-collateral'].unavailableReason,
    'EQUITY_COLLATERAL_VALUATION_NOT_PUBLISHED',
  );
  assert.equal(
    fields(envelope.surfaces.markets).flow.unavailableReason,
    'MARKET_FLOW_SEMANTICS_NOT_PUBLISHED',
  );

  const keylessCut = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead: notConfiguredPrivateRead(),
    markets: availableMarkets(),
  });
  const keylessEnvelope = buildProductRuntimeSupervisorEnvelope({
    applicationStartOk: true,
    snapshot: supervisor,
    opsReadback: makeOpsReadback(),
    opsIntakeInterlock: makeOpsInterlock(),
    materialEvents,
    traces: [],
    ownerTruthCut: keylessCut,
    ownerTruthUnavailableReason: null,
    nowMs: T0,
  });
  for (const field of keylessEnvelope.surfaces.account.evidence) {
    assert.equal(field.value, null);
    assert.equal(field.truthLabel, 'NOT_CONFIGURED');
    assert.equal(field.unavailableReason, 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED');
  }
});

test('unavailable or malformed market and timestamp inputs fail closed with source-specific reasons', () => {
  const supervisor = makeSupervisor();
  const privateRead = availablePrivateRead();
  const allUnavailable = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead,
    markets: availableMarkets({
      dataSources: Object.freeze({
        spotBookTicker: 'unavailable',
        futuresBookTicker: 'unavailable',
        futures24hTicker: 'unavailable',
      }),
    }),
  });
  const unavailableMarkets = surface(allUnavailable, 'markets');
  assert.equal(unavailableMarkets.state, 'UNAVAILABLE');
  assert.equal(unavailableMarkets.unavailableReason, 'MARKET_PUBLIC_SOURCES_UNAVAILABLE');
  const unavailableEnvelope = buildProductRuntimeSupervisorEnvelope({
    applicationStartOk: true,
    snapshot: supervisor,
    opsReadback: makeOpsReadback(),
    opsIntakeInterlock: makeOpsInterlock(),
    materialEvents: projectProductMaterialEventPage(
      '0',
      10,
      makeRead().events({ afterCursor: '0', limit: 10 }),
    ),
    traces: [],
    ownerTruthCut: allUnavailable,
    ownerTruthUnavailableReason: null,
    nowMs: T0,
  });
  assert.deepEqual(
    unavailableEnvelope.surfaces.markets.evidence.map((field) => field.fieldId),
    MARKETS_FIELDS,
  );
  for (const field of unavailableEnvelope.surfaces.markets.evidence) {
    assert.equal(field.value, null);
    assert.equal(field.truthLabel, 'UNAVAILABLE');
    assert.equal(field.unavailableReason, 'MARKET_PUBLIC_SOURCES_UNAVAILABLE');
  }

  const invalidMarketTime = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead,
    markets: availableMarkets({ observedAtMs: Number.NaN }),
  });
  assert.equal(
    surface(invalidMarketTime, 'markets').unavailableReason,
    'MARKET_SOURCE_OBSERVED_AT_INVALID',
  );

  const invalidPrivateTime = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead: Object.freeze({
      ...privateRead,
      observedAt: null,
      permissionPosture: Object.freeze({ ...privateRead.permissionPosture, observedAt: null }),
    }),
    markets: availableMarkets(),
  });
  assert.equal(
    surface(invalidPrivateTime, 'account').unavailableReason,
    'PRIVATE_ACCOUNT_OBSERVED_AT_INVALID',
  );

  const malformedRows = projectProductRuntimeOwnerTruthCut({
    supervisor,
    privateRead,
    markets: availableMarkets({ rows: null }),
  });
  assert.equal(surface(malformedRows, 'markets').unavailableReason, 'MARKET_ROWS_MALFORMED');
});
