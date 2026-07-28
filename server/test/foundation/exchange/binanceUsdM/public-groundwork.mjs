#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBinanceUsdMPublicGroundworkSeam,
  validateTestOrder,
} from '../../../../dist/foundation/exchange/binanceUsdM/validation.js';

const T0 = 1_800_000_000_000;
const FRESHNESS_MS = 60_000;

function observedAt(sourceId, overrides = {}) {
  return Object.freeze({
    sourceTimeMs: Object.hasOwn(overrides, 'sourceTimeMs')
      ? overrides.sourceTimeMs
      : T0 - 1,
    receivedAtMs: overrides.receivedAtMs ?? T0,
    maxAgeMs: overrides.maxAgeMs ?? FRESHNESS_MS,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    completeness: overrides.completeness ?? 'COMPLETE',
    sourceId,
  });
}

function filters(overrides = {}) {
  return Object.freeze({
    price: Object.freeze({
      minPrice: '0.1',
      maxPrice: '1000000',
      tickSize: '0.1',
      ...overrides.price,
    }),
    lotSize: Object.freeze({
      minQty: '0.001',
      maxQty: '100',
      stepSize: '0.001',
      ...overrides.lotSize,
    }),
    marketLotSize: Object.freeze({
      minQty: '0.001',
      maxQty: '50',
      stepSize: '0.001',
      ...overrides.marketLotSize,
    }),
    minNotional: overrides.minNotional ?? '5',
    percentPrice: Object.freeze({
      multiplierUp: '1.15',
      multiplierDown: '0.85',
      multiplierDecimal: 4,
      ...overrides.percentPrice,
    }),
    maxNumOrders: Object.hasOwn(overrides, 'maxNumOrders')
      ? overrides.maxNumOrders
      : 200,
    unsupportedFilterTypes: Object.freeze([...(overrides.unsupportedFilterTypes ?? [])]),
  });
}

function exchangeSymbol(overrides = {}) {
  return Object.freeze({
    symbol: overrides.symbol ?? 'BTCUSDT',
    status: overrides.status ?? 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    orderTypes: Object.freeze(['LIMIT', 'MARKET']),
    timeInForce: Object.freeze(['GTC', 'IOC']),
    filters: overrides.filters ?? filters(),
    observedAt: overrides.observedAt ?? observedAt('binance.usdm.exchange-info.fixture'),
  });
}

function forecast(overrides = {}) {
  return Object.freeze({
    revision: overrides.revision ?? 'forecast-revision-1',
    observedAt: overrides.observedAt ?? observedAt('binance.usdm.mark-funding.fixture'),
    value: Object.freeze({
      symbol: 'BTCUSDT',
      markPrice: '50000.12345678901234567890123456789',
      indexPrice: '49999.98765432109876543210987654321',
      estimatedSettlePrice: '50001.00000000000000000000000000001',
      lastFundingRate: '0.00012345678901234567890123456789',
      interestRate: '0.0001',
      nextFundingTimeMs: T0 + 28_800_000,
      sourceTimeMs: T0 - 1,
      ...overrides.value,
    }),
  });
}

function fundingRow(overrides = {}) {
  return Object.freeze({
    symbol: 'BTCUSDT',
    fundingRate: '0.0001',
    fundingTimeMs: T0 - 28_800_000,
    markPrice: '50000.1',
    rateType: 'Regular',
    ...overrides,
  });
}

function fundingHistory(overrides = {}) {
  return Object.freeze({
    revision: overrides.revision ?? 'history-revision-1',
    observedAt: overrides.observedAt ?? observedAt(
      'binance.usdm.funding-history.fixture',
      { sourceTimeMs: null },
    ),
    rows: Object.freeze([...(overrides.rows ?? [fundingRow()])]),
  });
}

function groundworkInput(overrides = {}) {
  return Object.freeze({
    nowMs: overrides.nowMs ?? T0,
    currentEffectiveKillSwitchEngaged:
      Object.hasOwn(overrides, 'currentEffectiveKillSwitchEngaged')
        ? overrides.currentEffectiveKillSwitchEngaged
        : false,
    symbol: overrides.symbol ?? 'BTCUSDT',
    exchangeSymbol: overrides.exchangeSymbol ?? exchangeSymbol(),
    fundingForecast: overrides.fundingForecast ?? forecast(),
    fundingHistory: overrides.fundingHistory ?? fundingHistory(),
  });
}

function enabledConfig(overrides = {}) {
  return Object.freeze({
    sourceEnabled: true,
    allowedSymbols: Object.freeze(['BTCUSDT']),
    maximumFilterAgeMs: FRESHNESS_MS,
    maximumForecastAgeMs: FRESHNESS_MS,
    maximumHistoryCaptureAgeMs: FRESHNESS_MS,
    ...overrides,
  });
}

function limitOrder(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    positionMode: 'ONE_WAY',
    positionSide: 'BOTH',
    quantity: '1',
    price: '100',
    timeInForce: 'GTC',
    notionalReferencePrice: '100',
    exchangeSymbol: exchangeSymbol(),
    ...overrides,
  };
}

function assertDeepFrozen(value, path = 'result', seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(value[key], `${path}.${String(key)}`, seen);
  }
}

test('public groundwork is opt-in and only literal false kill evidence admits source truth', () => {
  const input = groundworkInput();
  assert.equal(createBinanceUsdMPublicGroundworkSeam().validate(input).validationPassed, false);
  assert.equal(createBinanceUsdMPublicGroundworkSeam(enabledConfig({ sourceEnabled: false })).validate(input).validationPassed, false);

  const seam = createBinanceUsdMPublicGroundworkSeam(enabledConfig());
  assert.equal(seam.validate(groundworkInput({ currentEffectiveKillSwitchEngaged: true })).validationPassed, false);
  assert.equal(seam.validate(groundworkInput({ currentEffectiveKillSwitchEngaged: null })).validationPassed, false);
  assert.equal(seam.validate(groundworkInput({ currentEffectiveKillSwitchEngaged: false })).validationPassed, true);
});

test('happy path preserves exact public decimals while remaining frozen and zero-authority', () => {
  const result = createBinanceUsdMPublicGroundworkSeam(enabledConfig()).validate(groundworkInput());

  assert.equal(result.validationPassed, true);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(result.fundingForecast.kind, 'FORECAST_ONLY');
  assert.equal(result.fundingForecast.capturedAsSettlement, false);
  assert.equal(result.fundingHistory.kind, 'PUBLIC_SETTLEMENT_RATE_HISTORY');
  assert.equal(result.fundingHistory.capturesPublicSettlementRate, true);
  assert.equal(result.fundingHistory.capturesAccountPayment, false);
  assert.equal(result.fundingHistory.observedAt.sourceTimeMs, null);
  assert.equal(
    result.fundingForecast.value.lastFundingRate,
    '0.00012345678901234567890123456789',
  );
  assert.equal(result.filters.price.tickSize, '0.1');
  assert.equal(result.filters.maxNumOrders, 200);
  assert.equal(
    result.filters.maxNumOrdersEvaluation,
    'NOT_EVALUATED_PRIVATE_OPEN_ORDER_TRUTH_UNAVAILABLE',
  );
  assert.deepEqual(result.permittedExternalActions, []);
  assert.equal(result.networkRequestsPerformed, 0);
  assert.equal(result.privateRequestsPerformed, 0);
  assert.equal(result.signedRequestsPerformed, 0);
  assert.equal(result.ordersPerformed, 0);
  assert.equal(result.sideEffectsPerformed, 0);
  assertDeepFrozen(result);
});

test('hostile decimal bounds and unsupported filters fail closed', () => {
  const seam = createBinanceUsdMPublicGroundworkSeam(enabledConfig());
  const hostile = '9'.repeat(81);
  const hostileForecast = forecast({ value: { markPrice: hostile } });
  assert.equal(seam.validate(groundworkInput({ fundingForecast: hostileForecast })).validationPassed, false);

  const unknown = exchangeSymbol({
    filters: filters({ unsupportedFilterTypes: ['SOME_NEW_VENUE_FILTER'] }),
  });
  assert.equal(seam.validate(groundworkInput({ exchangeSymbol: unknown })).validationPassed, false);
});

test('filter, forecast, and history provenance fail closed when stale, future, private, or mismatched', () => {
  const staleReceivedAtMs = T0 - FRESHNESS_MS - 1;
  const seam = createBinanceUsdMPublicGroundworkSeam(enabledConfig());
  const cases = [
    [
      'stale filters',
      groundworkInput({
        exchangeSymbol: exchangeSymbol({
          observedAt: observedAt('binance.usdm.exchange-info.fixture', {
            sourceTimeMs: staleReceivedAtMs,
            receivedAtMs: staleReceivedAtMs,
          }),
        }),
      }),
      'EXCHANGE_SYMBOL_STALE',
    ],
    [
      'private-authority filters',
      groundworkInput({
        exchangeSymbol: exchangeSymbol({
          observedAt: observedAt('binance.usdm.exchange-info.fixture', {
            authority: 'LIVE_PRIVATE',
          }),
        }),
      }),
      'EXCHANGE_SYMBOL_STALE',
    ],
    [
      'stale forecast',
      groundworkInput({
        fundingForecast: forecast({
          observedAt: observedAt('binance.usdm.mark-funding.fixture', {
            sourceTimeMs: staleReceivedAtMs,
            receivedAtMs: staleReceivedAtMs,
          }),
          value: { sourceTimeMs: staleReceivedAtMs },
        }),
      }),
      'FUNDING_FORECAST_STALE',
    ],
    [
      'future forecast',
      groundworkInput({
        fundingForecast: forecast({
          observedAt: observedAt('binance.usdm.mark-funding.fixture', {
            sourceTimeMs: T0 + 1,
            receivedAtMs: T0 + 1,
          }),
          value: { sourceTimeMs: T0 + 1 },
        }),
      }),
      'FUNDING_FORECAST_STALE',
    ],
    [
      'private-authority forecast',
      groundworkInput({
        fundingForecast: forecast({
          observedAt: observedAt('binance.usdm.mark-funding.fixture', {
            authority: 'LIVE_PRIVATE',
          }),
        }),
      }),
      'FUNDING_FORECAST_STALE',
    ],
    [
      'forecast source-time mismatch',
      groundworkInput({
        fundingForecast: forecast({
          value: { sourceTimeMs: T0 - 2 },
        }),
      }),
      'FUNDING_FORECAST_INVALID',
    ],
    [
      'stale history capture',
      groundworkInput({
        fundingHistory: fundingHistory({
          observedAt: observedAt('binance.usdm.funding-history.fixture', {
            sourceTimeMs: null,
            receivedAtMs: staleReceivedAtMs,
          }),
        }),
      }),
      'FUNDING_HISTORY_STALE',
    ],
    [
      'private-authority history capture',
      groundworkInput({
        fundingHistory: fundingHistory({
          observedAt: observedAt('binance.usdm.funding-history.fixture', {
            sourceTimeMs: null,
            authority: 'LIVE_PRIVATE',
          }),
        }),
      }),
      'FUNDING_HISTORY_STALE',
    ],
    [
      'history capture with invented response source time',
      groundworkInput({
        fundingHistory: fundingHistory({
          observedAt: observedAt('binance.usdm.funding-history.fixture'),
        }),
      }),
      'FUNDING_HISTORY_STALE',
    ],
    [
      'post-capture funding row',
      groundworkInput({
        fundingHistory: fundingHistory({
          observedAt: observedAt('binance.usdm.funding-history.fixture', {
            sourceTimeMs: null,
            receivedAtMs: T0 - 2,
          }),
          rows: [fundingRow({ fundingTimeMs: T0 - 1 })],
        }),
      }),
      'FUNDING_HISTORY_POST_CAPTURE',
    ],
  ];

  for (const [name, input, code] of cases) {
    const result = seam.validate(input);
    assert.equal(result.validationPassed, false, name);
    assert.ok(result.blockingCodes.includes(code), `${name}: ${result.blockingCodes.join(',')}`);
  }
});

test('USD-M PERCENT_PRICE is side-specific: BUY has only an upper bound and SELL only a lower bound', () => {
  const percentFilters = filters({
    price: { minPrice: '0', maxPrice: '1000', tickSize: '1' },
    lotSize: { minQty: '1', maxQty: '10', stepSize: '1' },
    marketLotSize: { minQty: '1', maxQty: '10', stepSize: '1' },
    minNotional: '0',
    percentPrice: { multiplierUp: '1.1', multiplierDown: '0.9' },
    maxNumOrders: null,
  });
  const rules = exchangeSymbol({ filters: percentFilters });

  const buyBelow = validateTestOrder(limitOrder({
    side: 'BUY',
    price: '80',
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(buyBelow.ok, true, buyBelow.ok ? '' : JSON.stringify(buyBelow.issues));
  const buyAbove = validateTestOrder(limitOrder({
    side: 'BUY',
    price: '111',
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(buyAbove.ok, false);
  assert.ok(buyAbove.issues.some((issue) => issue.code === 'PRICE_ABOVE_PERCENT_LIMIT'));

  const sellAbove = validateTestOrder(limitOrder({
    side: 'SELL',
    price: '120',
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(sellAbove.ok, true, sellAbove.ok ? '' : JSON.stringify(sellAbove.issues));
  const sellBelow = validateTestOrder(limitOrder({
    side: 'SELL',
    price: '89',
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(sellBelow.ok, false);
  assert.ok(sellBelow.issues.some((issue) => issue.code === 'PRICE_BELOW_PERCENT_LIMIT'));
});

test('MARKET quantity is admitted only by the intersection of LOT_SIZE and MARKET_LOT_SIZE', () => {
  const marketFilters = filters({
    price: { minPrice: '0', maxPrice: '1000', tickSize: '1' },
    lotSize: { minQty: '1', maxQty: '10', stepSize: '2' },
    marketLotSize: { minQty: '1', maxQty: '10', stepSize: '3' },
    minNotional: '0',
    maxNumOrders: null,
  });
  const rules = exchangeSymbol({ filters: marketFilters });

  const marketOnly = validateTestOrder(limitOrder({
    type: 'MARKET',
    quantity: '4',
    price: undefined,
    timeInForce: undefined,
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(marketOnly.ok, false);
  assert.ok(marketOnly.issues.some((issue) => issue.code === 'QUANTITY_STEP_MISMATCH'));

  const intersection = validateTestOrder(limitOrder({
    type: 'MARKET',
    quantity: '7',
    price: undefined,
    timeInForce: undefined,
    notionalReferencePrice: '100',
    exchangeSymbol: rules,
  }), T0);
  assert.equal(intersection.ok, true, intersection.ok ? '' : JSON.stringify(intersection.issues));
});

test('funding history stays finalized-only, retains Regular and Special peers, and dedupes in deterministic order', () => {
  const oldRegular = fundingRow({
    fundingRate: '0.00001',
    fundingTimeMs: T0 - 57_600_000,
    rateType: 'Regular',
  });
  const regular = fundingRow({
    fundingRate: '0.00002',
    fundingTimeMs: T0 - 28_800_000,
    rateType: 'Regular',
  });
  const special = fundingRow({
    fundingRate: '0.00003',
    fundingTimeMs: T0 - 28_800_000,
    rateType: 'Special',
  });
  const input = groundworkInput({
    fundingHistory: fundingHistory({ rows: [special, regular, oldRegular, regular] }),
  });
  const result = createBinanceUsdMPublicGroundworkSeam(enabledConfig()).validate(input);

  assert.equal(result.validationPassed, true);
  assert.equal(result.fundingForecast.kind, 'FORECAST_ONLY');
  assert.equal(result.fundingForecast.capturedAsSettlement, false);
  assert.equal(result.fundingHistory.kind, 'PUBLIC_SETTLEMENT_RATE_HISTORY');
  assert.equal(result.fundingHistory.capturesPublicSettlementRate, true);
  assert.equal(result.fundingHistory.capturesAccountPayment, false);
  assert.deepEqual(
    result.fundingHistory.rows.map(({ fundingTimeMs, rateType }) => [fundingTimeMs, rateType]),
    [
      [T0 - 57_600_000, 'Regular'],
      [T0 - 28_800_000, 'Regular'],
      [T0 - 28_800_000, 'Special'],
    ],
  );
  assert.equal(result.fundingHistory.rows.length, 3);
  assert.equal(
    result.fundingHistory.rows.some((row) => row.fundingRate === result.fundingForecast.value.lastFundingRate),
    false,
  );
  assertDeepFrozen(result);
});

test('funding history rejects conflicting values for one settlement identity', () => {
  const regular = fundingRow({
    fundingRate: '0.00002',
    fundingTimeMs: T0 - 28_800_000,
    rateType: 'Regular',
  });
  const conflict = fundingRow({
    fundingRate: '0.00009',
    fundingTimeMs: regular.fundingTimeMs,
    rateType: regular.rateType,
  });
  const seam = createBinanceUsdMPublicGroundworkSeam(enabledConfig());

  const result = seam.validate(groundworkInput({
    fundingHistory: fundingHistory({ rows: [regular, conflict] }),
  }));
  assert.equal(result.validationPassed, false);
  assert.ok(result.blockingCodes.includes('FUNDING_HISTORY_CONFLICT'));
});
