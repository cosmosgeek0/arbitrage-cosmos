#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBinanceUsdMPublicGroundworkSeam,
} from '../../../../dist/foundation/exchange/binanceUsdM/validation.js';
import {
  DEFAULT_BINANCE_USDM_BASIS_ADAPTER_CONFIG,
  createBinanceUsdMBasisValidateOnlyAdapter,
  isBinanceUsdMBasisIntentResult,
  isBinanceUsdMBasisQueryDescriptor,
  isBinanceUsdMBasisQueryDescriptorResult,
  isBinanceUsdMBasisQueryResolution,
  isBinanceUsdMBasisWireIntent,
} from '../../../../dist/foundation/exchange/binanceUsdMAdapter/index.js';

export const T0 = 1_900_000_000_000;
const MAX_AGE_MS = 60_000;
const FORECAST_MAX_AGE_MS = 15_000;

function observedAt(sourceId, overrides = {}) {
  return Object.freeze({
    sourceTimeMs: Object.hasOwn(overrides, 'sourceTimeMs')
      ? overrides.sourceTimeMs
      : T0 - 1,
    receivedAtMs: overrides.receivedAtMs ?? T0,
    maxAgeMs: overrides.maxAgeMs ?? MAX_AGE_MS,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    completeness: overrides.completeness ?? 'COMPLETE',
    sourceId,
  });
}

function exchangeFilters(overrides = {}) {
  return Object.freeze({
    price: Object.freeze({
      minPrice: '0.1',
      maxPrice: '1000000',
      tickSize: '0.1',
      ...(overrides.price ?? {}),
    }),
    lotSize: Object.freeze({
      minQty: '0.001',
      maxQty: '100',
      stepSize: '0.001',
      ...(overrides.lotSize ?? {}),
    }),
    marketLotSize: Object.freeze({
      minQty: '0.001',
      maxQty: '50',
      stepSize: '0.001',
      ...(overrides.marketLotSize ?? {}),
    }),
    minNotional: overrides.minNotional ?? '5',
    percentPrice: Object.freeze({
      multiplierUp: '1.15',
      multiplierDown: '0.85',
      multiplierDecimal: 4,
      ...(overrides.percentPrice ?? {}),
    }),
    maxNumOrders: Object.hasOwn(overrides, 'maxNumOrders')
      ? overrides.maxNumOrders
      : 200,
    unsupportedFilterTypes: Object.freeze([
      ...(overrides.unsupportedFilterTypes ?? []),
    ]),
  });
}

function exchangeSymbol(overrides = {}) {
  return Object.freeze({
    symbol: overrides.symbol ?? 'BTCUSDT',
    status: overrides.status ?? 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    orderTypes: Object.freeze([
      ...(overrides.orderTypes ?? ['LIMIT', 'MARKET']),
    ]),
    timeInForce: Object.freeze([
      ...(overrides.timeInForce ?? ['GTC', 'IOC']),
    ]),
    filters: overrides.filters ?? exchangeFilters(),
    observedAt:
      overrides.observedAt ??
      observedAt('binance.usdm.exchange-info.adapter-fixture'),
  });
}

export function fundingForecast(overrides = {}) {
  return Object.freeze({
    revision: overrides.revision ?? 'forecast-revision-1',
    observedAt:
      overrides.observedAt ??
      observedAt('binance.usdm.mark-price.adapter-fixture', {
        maxAgeMs: FORECAST_MAX_AGE_MS,
      }),
    value: Object.freeze({
      symbol: overrides.symbol ?? 'BTCUSDT',
      markPrice: overrides.markPrice ?? '50000.1',
      indexPrice: '50000',
      estimatedSettlePrice: '50000.1',
      lastFundingRate: '0.0001',
      interestRate: '0.0001',
      nextFundingTimeMs: T0 + 28_800_000,
      sourceTimeMs: T0 - 1,
    }),
  });
}

function fundingHistory() {
  return Object.freeze({
    revision: 'history-revision-1',
    observedAt: observedAt(
      'binance.usdm.funding-history.adapter-fixture',
      { sourceTimeMs: null },
    ),
    rows: Object.freeze([
      Object.freeze({
        symbol: 'BTCUSDT',
        fundingRate: '0.0001',
        fundingTimeMs: T0 - 28_800_000,
        markPrice: '50000.1',
        rateType: 'Regular',
      }),
    ]),
  });
}

export function publicEvidence(overrides = {}) {
  const symbolFacts = overrides.exchangeSymbol ?? exchangeSymbol();
  const seam = createBinanceUsdMPublicGroundworkSeam(Object.freeze({
    sourceEnabled: true,
    allowedSymbols: Object.freeze(['BTCUSDT']),
    maximumFilterAgeMs: MAX_AGE_MS,
    maximumForecastAgeMs: FORECAST_MAX_AGE_MS,
    maximumHistoryCaptureAgeMs: MAX_AGE_MS,
  }));
  const groundwork = seam.validate(Object.freeze({
    nowMs: T0,
    currentEffectiveKillSwitchEngaged: false,
    symbol: 'BTCUSDT',
    exchangeSymbol: symbolFacts,
    fundingForecast: overrides.fundingForecast ?? fundingForecast(),
    fundingHistory: fundingHistory(),
  }));
  assert.equal(groundwork.validationPassed, true);
  return Object.freeze({
    groundwork,
    orderCapabilities: Object.freeze({
      revision: 'exchange-info-capabilities-revision-1',
      observedAt: groundwork.filters.observedAt,
      orderTypes: symbolFacts.orderTypes,
      timeInForce: symbolFacts.timeInForce,
    }),
  });
}

function forgedPublicEvidence(overrides = {}) {
  const valid = publicEvidence();
  const filterObservedAt = Object.freeze({
    ...valid.groundwork.filters.observedAt,
    ...(overrides.filterObservedAt ?? {}),
  });
  const capabilityObservedAt = Object.freeze({
    ...filterObservedAt,
    ...(overrides.capabilityObservedAt ?? {}),
  });
  const forecastObservedAt = Object.freeze({
    ...valid.groundwork.fundingForecast.observedAt,
    ...(overrides.forecastObservedAt ?? {}),
  });
  const forecastValue = Object.freeze({
    ...valid.groundwork.fundingForecast.value,
    ...(overrides.forecastValue ?? {}),
  });
  const forecast = Object.freeze({
    ...valid.groundwork.fundingForecast,
    observedAt: forecastObservedAt,
    value: forecastValue,
    ...(overrides.forecast ?? {}),
  });
  const filters = Object.freeze({
    ...valid.groundwork.filters,
    observedAt: filterObservedAt,
    ...(overrides.filters ?? {}),
  });
  const groundwork = Object.freeze({
    ...valid.groundwork,
    filters,
    fundingForecast: forecast,
  });
  return Object.freeze({
    groundwork,
    orderCapabilities: Object.freeze({
      ...valid.orderCapabilities,
      revision:
        overrides.capabilityRevision ??
        valid.orderCapabilities.revision,
      observedAt: capabilityObservedAt,
    }),
  });
}

export function positionModeEvidence(overrides = {}) {
  return Object.freeze({
    mode: overrides.mode ?? 'ONE_WAY',
    scope: overrides.scope ?? 'ACCOUNT',
    symbol: Object.hasOwn(overrides, 'symbol') ? overrides.symbol : null,
    observedAtMs: overrides.observedAtMs ?? T0 - 1,
    receivedAtMs: overrides.receivedAtMs ?? T0,
    maxAgeMs: overrides.maxAgeMs ?? MAX_AGE_MS,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    sourceId:
      overrides.sourceId ??
      'binance.usdm.position-mode.account.fixture',
    revision: overrides.revision ?? 'position-mode-revision-1',
  });
}

export function intentInput(overrides = {}) {
  const base = {
    nowMs: T0,
    leg: 'PERP_OPEN',
    symbol: 'BTCUSDT',
    existingClientOrderId: 'm1i1-perp-open-a1',
    type: 'LIMIT',
    quantity: '0.01',
    price: '50000.1',
    positionModeEvidence: positionModeEvidence(),
    positionSide: 'BOTH',
    publicEvidence: publicEvidence(),
  };
  const merged = { ...base, ...overrides };
  if (overrides.type === 'MARKET' && !Object.hasOwn(overrides, 'price')) {
    delete merged.price;
  }
  return Object.freeze(merged);
}

export function enabledAdapter(overrides = {}) {
  return createBinanceUsdMBasisValidateOnlyAdapter(Object.freeze({
    enabled: true,
    sourceEnabled: true,
    killSwitchEngaged: false,
    authority: 'NONE',
    allowedSymbols: Object.freeze(['BTCUSDT']),
    ...overrides,
  }));
}

export function foundEvidence(intent, overrides = {}) {
  return Object.freeze({
    nowMs: overrides.nowMs ?? T0,
    observedAtMs: overrides.observedAtMs ?? T0 - 1,
    receivedAtMs: overrides.receivedAtMs ?? T0,
    maxAgeMs: overrides.maxAgeMs ?? MAX_AGE_MS,
    authority: overrides.authority ?? 'SYNTHETIC_TEST',
    outcome: overrides.outcome ?? 'FOUND',
    ...(overrides.omitOrder
      ? {}
      : {
          order: Object.freeze({
            symbol: intent.symbol,
            clientOrderId: intent.existingClientOrderId,
            side: intent.side,
            type: intent.type,
            origQty: intent.quantity,
            executedQty: intent.quantity,
            price: intent.price ?? '0',
            timeInForce: 'GTC',
            positionSide: intent.positionSide,
            reduceOnly: intent.reduceOnly,
            closePosition: false,
            status: 'FILLED',
            ...(overrides.order ?? {}),
          }),
        }),
  });
}

test('defaults are frozen OFF/OFF/kill-ON/authority-NONE and fail closed', () => {
  assert.equal(Object.isFrozen(DEFAULT_BINANCE_USDM_BASIS_ADAPTER_CONFIG), true);
  assert.deepEqual(DEFAULT_BINANCE_USDM_BASIS_ADAPTER_CONFIG, {
    enabled: false,
    sourceEnabled: false,
    killSwitchEngaged: true,
    authority: 'NONE',
    allowedSymbols: [],
  });
  const adapter = createBinanceUsdMBasisValidateOnlyAdapter();
  const result = adapter.buildOrderIntent(intentInput());
  assert.equal(result.ok, false);
  assert.equal(result.intent, null);
  assert.deepEqual(result.blockingCodes, [
    'ADAPTER_DISABLED',
    'SOURCE_DISABLED',
    'KILL_SWITCH_ENGAGED_OR_UNKNOWN',
    'SYMBOL_NOT_ALLOWLISTED',
  ]);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.sendEligible, false);
  assert.equal(result.networkRequestsPerformed, 0);
  assert.equal(result.privateRequestsPerformed, 0);
  assert.equal(result.signedRequestsPerformed, 0);
  assert.equal(result.testOrdersPerformed, 0);
  assert.equal(result.ordersPerformed, 0);
  assert.equal(result.sideEffectsPerformed, 0);
  assert.equal(isBinanceUsdMBasisIntentResult(result), true);
  assert.equal(isBinanceUsdMBasisWireIntent({ ...result }), false);
});

test('builds immutable non-callable one-way open and close descriptors', () => {
  const adapter = enabledAdapter();
  const open = adapter.buildOrderIntent(intentInput());
  assert.equal(open.ok, true);
  assert.equal(isBinanceUsdMBasisIntentResult(open), true);
  assert.equal(isBinanceUsdMBasisWireIntent(open.intent), true);
  assert.equal(Object.isFrozen(open), true);
  assert.equal(Object.isFrozen(open.intent), true);
  assert.deepEqual(
    {
      callable: open.intent.callable,
      endpoint: open.intent.endpoint,
      method: open.intent.method,
      security: open.intent.security,
      side: open.intent.side,
      positionMode: open.intent.positionMode,
      positionSide: open.intent.positionSide,
      reduceOnly: open.intent.reduceOnly,
      closePosition: open.intent.closePosition,
      quantity: open.intent.quantity,
      price: open.intent.price,
      timeInForce: open.intent.timeInForce,
      sendEligible: open.intent.sendEligible,
      authority: open.intent.authority,
    },
    {
      callable: false,
      endpoint: '/fapi/v1/order',
      method: 'POST',
      security: 'SIGNED_DESCRIPTOR_ONLY',
      side: 'SELL',
      positionMode: 'ONE_WAY',
      positionSide: 'BOTH',
      reduceOnly: false,
      closePosition: false,
      quantity: '0.01',
      price: '50000.1',
      timeInForce: 'GTC',
      sendEligible: false,
      authority: 'NONE',
    },
  );
  assert.deepEqual(open.intent.limitations, [
    'PRIVATE_MAX_NUM_ORDERS_UNEVALUATED',
    'MATCHING_ENGINE_ACCEPTANCE_UNPROVEN',
  ]);
  assert.equal(open.intent.localValidation.publicMaxNumOrders, 200);
  assert.equal(
    open.intent.localValidation.publicEvidenceSourceTimeMs,
    T0 - 1,
  );
  assert.equal(
    open.intent.localValidation.publicEvidenceMaxAgeMs,
    MAX_AGE_MS,
  );
  assert.equal(
    open.intent.localValidation.publicEvidenceAuthority,
    'SYNTHETIC_TEST',
  );
  assert.equal(
    open.intent.localValidation.referenceMarkPriceRevision,
    'forecast-revision-1',
  );
  assert.equal(
    open.intent.localValidation.referenceMarkPriceSourceId,
    'binance.usdm.mark-price.adapter-fixture',
  );
  assert.equal(
    open.intent.localValidation.referenceMarkPriceSourceTimeMs,
    T0 - 1,
  );
  assert.equal(
    open.intent.localValidation.referenceMarkPriceMaxAgeMs,
    FORECAST_MAX_AGE_MS,
  );
  assert.equal(
    open.intent.localValidation.privateOpenOrderCountEvaluated,
    false,
  );
  assert.equal(
    open.intent.localValidation.matchingEngineAcceptanceProven,
    false,
  );
  assert.equal(
    open.intent.localValidation.positionModeAuthority,
    'SYNTHETIC_TEST',
  );
  assert.equal(
    open.intent.localValidation.positionModeScope,
    'ACCOUNT',
  );
  assert.equal(open.intent.localValidation.positionModeSymbol, null);
  assert.equal(
    open.intent.localValidation.positionModeSourceId,
    'binance.usdm.position-mode.account.fixture',
  );
  assert.equal(
    open.intent.localValidation.positionModeRevision,
    'position-mode-revision-1',
  );

  const close = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_CLOSE',
    existingClientOrderId: 'm1i1-perp-close-a1',
    type: 'MARKET',
  }));
  assert.equal(close.ok, true);
  assert.equal(close.intent.side, 'BUY');
  assert.equal(close.intent.reduceOnly, true);
  assert.equal(close.intent.price, null);
  assert.equal(close.intent.timeInForce, null);
  assert.equal(close.intent.closePosition, false);
});

test('requires fresh account-wide replay/test position-mode provenance', () => {
  const adapter = enabledAdapter();
  const cases = [
    [
      positionModeEvidence({ mode: 'UNKNOWN' }),
      'POSITION_MODE_UNKNOWN',
    ],
    [
      positionModeEvidence({ mode: 'HEDGE' }),
      'POSITION_MODE_UNSUPPORTED',
    ],
    [
      positionModeEvidence({ authority: 'LIVE_PRIVATE' }),
      'POSITION_MODE_AUTHORITY_INVALID',
    ],
    [
      positionModeEvidence({
        observedAtMs: T0 - MAX_AGE_MS - 1,
        receivedAtMs: T0 - MAX_AGE_MS - 1,
      }),
      'POSITION_MODE_EVIDENCE_STALE',
    ],
    [
      positionModeEvidence({ observedAtMs: T0 + 1 }),
      'POSITION_MODE_EVIDENCE_FUTURE',
    ],
    [
      positionModeEvidence({
        scope: 'SYMBOL',
        symbol: 'BTCUSDT',
      }),
      'POSITION_MODE_EVIDENCE_INVALID',
    ],
    [
      positionModeEvidence({ sourceId: '' }),
      'POSITION_MODE_EVIDENCE_INVALID',
    ],
    [
      positionModeEvidence({ revision: 'contains whitespace' }),
      'POSITION_MODE_EVIDENCE_INVALID',
    ],
    [
      positionModeEvidence({ sourceId: `x${'y'.repeat(256)}` }),
      'POSITION_MODE_EVIDENCE_INVALID',
    ],
  ];
  for (const [evidence, expected] of cases) {
    const result = adapter.buildOrderIntent(intentInput({
      positionModeEvidence: evidence,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockingCodes.includes(expected), true);
  }
  const wrongSide = adapter.buildOrderIntent(intentInput({
    positionSide: 'SHORT',
  }));
  assert.equal(wrongSide.ok, false);
  assert.equal(
    wrongSide.blockingCodes.includes('POSITION_SIDE_INVALID'),
    true,
  );
});

test('preserves only canonical exact decimals and enforces public alignment', () => {
  const adapter = enabledAdapter();
  for (const quantity of ['1e-2', '-0', '0.0100', '0', ' 0.01']) {
    const result = adapter.buildOrderIntent(intentInput({ quantity }));
    assert.equal(result.ok, false, quantity);
    assert.equal(result.blockingCodes.includes('QUANTITY_INVALID'), true);
  }
  const quantityMisaligned = adapter.buildOrderIntent(intentInput({
    quantity: '0.0105',
  }));
  assert.equal(quantityMisaligned.ok, false);
  assert.equal(
    quantityMisaligned.blockingCodes.includes('QUANTITY_STEP_MISMATCH'),
    true,
  );
  const priceMisaligned = adapter.buildOrderIntent(intentInput({
    price: '50000.05',
  }));
  assert.equal(priceMisaligned.ok, false);
  assert.equal(
    priceMisaligned.blockingCodes.includes('PRICE_TICK_MISMATCH'),
    true,
  );
  const lossyPrice = adapter.buildOrderIntent(intentInput({
    price: '50000.10',
  }));
  assert.equal(lossyPrice.ok, false);
  assert.equal(lossyPrice.blockingCodes.includes('PRICE_INVALID'), true);
});

test('applies official side-directed PERCENT_PRICE bounds', () => {
  const adapter = enabledAdapter();
  const highSell = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_OPEN',
    price: '60000.1',
  }));
  assert.equal(highSell.ok, true, 'SELL has no upper PERCENT_PRICE block');

  const lowSell = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_OPEN',
    price: '40000.1',
  }));
  assert.equal(lowSell.ok, false);
  assert.equal(
    lowSell.blockingCodes.includes('PERCENT_PRICE_OUT_OF_RANGE'),
    true,
  );

  const lowBuy = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_CLOSE',
    price: '40000.1',
  }));
  assert.equal(lowBuy.ok, true, 'BUY has no lower PERCENT_PRICE block');

  const highBuy = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_CLOSE',
    price: '60000.1',
  }));
  assert.equal(highBuy.ok, false);
  assert.equal(
    highBuy.blockingCodes.includes('PERCENT_PRICE_OUT_OF_RANGE'),
    true,
  );
});

test('independently rejects forged public filter, capability, and mark provenance', () => {
  const adapter = enabledAdapter();
  const cases = [
    [
      'filter source stale despite fresh receipt',
      forgedPublicEvidence({
        filterObservedAt: { sourceTimeMs: T0 - MAX_AGE_MS - 1 },
      }),
    ],
    [
      'filter private authority',
      forgedPublicEvidence({
        filterObservedAt: { authority: 'LIVE_PRIVATE' },
      }),
    ],
    [
      'filter partial completeness',
      forgedPublicEvidence({
        filterObservedAt: { completeness: 'PARTIAL' },
      }),
    ],
    [
      'filter maxAge exceeds adapter ceiling',
      forgedPublicEvidence({
        filterObservedAt: { maxAgeMs: MAX_AGE_MS + 1 },
      }),
    ],
    [
      'filter source time follows receipt',
      forgedPublicEvidence({
        filterObservedAt: {
          sourceTimeMs: T0,
          receivedAtMs: T0 - 1,
        },
      }),
    ],
    [
      'filter source id is unbounded',
      forgedPublicEvidence({
        filterObservedAt: { sourceId: `x${'y'.repeat(256)}` },
      }),
    ],
    [
      'capability revision is malformed',
      forgedPublicEvidence({ capabilityRevision: 'bad revision' }),
    ],
    [
      'capability timestamp is stale',
      forgedPublicEvidence({
        capabilityObservedAt: {
          sourceTimeMs: T0 - MAX_AGE_MS - 1,
        },
      }),
    ],
    [
      'forecast source stale despite fresh receipt',
      forgedPublicEvidence({
        forecastObservedAt: {
          sourceTimeMs: T0 - FORECAST_MAX_AGE_MS - 1,
        },
        forecastValue: {
          sourceTimeMs: T0 - FORECAST_MAX_AGE_MS - 1,
        },
      }),
    ],
    [
      'forecast private authority',
      forgedPublicEvidence({
        forecastObservedAt: { authority: 'LIVE_PRIVATE' },
      }),
    ],
    [
      'forecast partial completeness',
      forgedPublicEvidence({
        forecastObservedAt: { completeness: 'PARTIAL' },
      }),
    ],
    [
      'forecast maxAge exceeds adapter ceiling',
      forgedPublicEvidence({
        forecastObservedAt: {
          maxAgeMs: FORECAST_MAX_AGE_MS + 1,
        },
      }),
    ],
    [
      'forecast revision is malformed',
      forgedPublicEvidence({
        forecast: { evidenceRevision: 'bad revision' },
      }),
    ],
    [
      'forecast source time is unavailable',
      forgedPublicEvidence({
        forecastObservedAt: { sourceTimeMs: null },
        forecastValue: { sourceTimeMs: null },
      }),
    ],
    [
      'forecast value source time conflicts with provenance',
      forgedPublicEvidence({
        forecastValue: { sourceTimeMs: T0 - 2 },
      }),
    ],
  ];

  for (const [label, evidence] of cases) {
    const result = adapter.buildOrderIntent(intentInput({
      publicEvidence: evidence,
    }));
    assert.equal(result.ok, false, label);
    assert.equal(result.intent, null, label);
    assert.equal(
      result.blockingCodes.some((code) =>
        code.startsWith('PUBLIC_')),
      true,
      label,
    );
  }
});

test('independently rejects zero MIN_NOTIONAL and inverted PERCENT_PRICE multipliers', () => {
  const adapter = enabledAdapter();
  const cases = [
    [
      'zero MIN_NOTIONAL',
      forgedPublicEvidence({
        filters: { minNotional: '0' },
      }),
    ],
    [
      'inverted PERCENT_PRICE multipliers',
      forgedPublicEvidence({
        filters: {
          percentPrice: Object.freeze({
            multiplierUp: '0.85',
            multiplierDown: '1.15',
            multiplierDecimal: 4,
          }),
        },
      }),
    ],
  ];

  for (const [label, evidence] of cases) {
    const result = adapter.buildOrderIntent(intentInput({
      publicEvidence: evidence,
    }));
    assert.equal(result.ok, false, label);
    assert.equal(result.intent, null, label);
    assert.deepEqual(result.blockingCodes, [
      'PUBLIC_FILTER_MALFORMED',
    ], label);
  }
});

test('rejects proxy and accessor input at every parsed boundary without invoking traps', () => {
  const adapter = enabledAdapter();
  let trapCalls = 0;
  const hostileProxy = new Proxy({}, {
    get() {
      trapCalls += 1;
      throw new Error('must not run');
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('must not run');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not run');
    },
  });
  const proxiedInput = adapter.buildOrderIntent(hostileProxy);
  assert.equal(proxiedInput.ok, false);
  assert.deepEqual(proxiedInput.blockingCodes, ['INPUT_INVALID']);
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'groundwork', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  const nestedAccessor = adapter.buildOrderIntent(intentInput({
    publicEvidence: accessor,
  }));
  assert.equal(nestedAccessor.ok, false);
  assert.equal(
    nestedAccessor.blockingCodes.includes('PUBLIC_VALIDATION_INVALID'),
    true,
  );
  assert.equal(getterCalls, 0);

  const nestedProxy = adapter.buildOrderIntent(intentInput({
    positionModeEvidence: hostileProxy,
  }));
  assert.equal(nestedProxy.ok, false);
  assert.equal(
    nestedProxy.blockingCodes.includes('POSITION_MODE_EVIDENCE_INVALID'),
    true,
  );
  assert.equal(trapCalls, 0);

  const revokedObject = Proxy.revocable({}, {});
  revokedObject.revoke();
  let revokedObjectResult;
  assert.doesNotThrow(() => {
    revokedObjectResult = adapter.buildOrderIntent(revokedObject.proxy);
  });
  assert.deepEqual(revokedObjectResult.blockingCodes, ['INPUT_INVALID']);

  const revokedArray = Proxy.revocable([], {});
  revokedArray.revoke();
  let revokedArrayResult;
  assert.doesNotThrow(() => {
    revokedArrayResult = adapter.buildOrderIntent(revokedArray.proxy);
  });
  assert.deepEqual(revokedArrayResult.blockingCodes, ['INPUT_INVALID']);

  const revokedSymbols = Proxy.revocable([], {});
  revokedSymbols.revoke();
  let revokedConfigAdapter;
  assert.doesNotThrow(() => {
    revokedConfigAdapter = createBinanceUsdMBasisValidateOnlyAdapter({
      enabled: true,
      sourceEnabled: true,
      killSwitchEngaged: false,
      authority: 'NONE',
      allowedSymbols: revokedSymbols.proxy,
    });
  });
  assert.equal(revokedConfigAdapter.enabled, false);

  const overWide = {};
  for (let index = 0; index < 65; index += 1) {
    overWide[`field${index}`] = index;
  }
  const overWideResult = adapter.buildOrderIntent(overWide);
  assert.deepEqual(overWideResult.blockingCodes, ['INPUT_INVALID']);

  const oversizedSymbols = Array.from(
    { length: 501 },
    (_, index) => `S${index}`,
  );
  const oversizedConfig = createBinanceUsdMBasisValidateOnlyAdapter({
    enabled: true,
    sourceEnabled: true,
    killSwitchEngaged: false,
    authority: 'NONE',
    allowedSymbols: oversizedSymbols,
  });
  assert.equal(oversizedConfig.enabled, false);
});

test('query descriptor reuses the existing client ID and is never callable', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);
  const result = adapter.buildOrderQueryDescriptor(built.intent);
  assert.equal(result.ok, true);
  assert.equal(isBinanceUsdMBasisQueryDescriptorResult(result), true);
  assert.equal(isBinanceUsdMBasisQueryDescriptor(result.descriptor), true);
  assert.deepEqual(result.descriptor.queryFields, {
    symbol: 'BTCUSDT',
    origClientOrderId: 'm1i1-perp-open-a1',
  });
  assert.equal(result.descriptor.callable, false);
  assert.equal(result.descriptor.method, 'GET');
  assert.equal(result.descriptor.security, 'SIGNED_DESCRIPTOR_ONLY');
  assert.equal(result.descriptor.queryFirstRequired, true);
  assert.equal(result.descriptor.blindResubmitAllowed, false);
  assert.equal(result.descriptor.signedRequestsPerformed, 0);

  const forged = adapter.buildOrderQueryDescriptor({
    ...built.intent,
  });
  assert.equal(forged.ok, false);
  assert.deepEqual(forged.blockingCodes, ['INTENT_NOT_ADAPTER_PRODUCED']);
});

test('query normalization confirms only fresh exact full identity', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);
  const resolution = adapter.normalizeOrderQueryEvidence(
    built.intent,
    foundEvidence(built.intent),
  );
  assert.equal(isBinanceUsdMBasisQueryResolution(resolution), true);
  assert.equal(resolution.state, 'CONFIRMED');
  assert.equal(resolution.order.status, 'FILLED');
  assert.equal(resolution.order.terminal, true);
  assert.equal(resolution.order.origQty, '0.01');
  assert.equal(resolution.order.timeInForce, 'GTC');
  assert.equal(resolution.order.venueTimeInForce, 'GTC');
  assert.equal(resolution.order.closePosition, false);
  assert.equal(resolution.evaluatedAtMs, T0);
  assert.equal(resolution.observedAtMs, T0 - 1);
  assert.equal(resolution.receivedAtMs, T0);
  assert.equal(resolution.maxAgeMs, MAX_AGE_MS);
  assert.equal(resolution.evidenceAuthority, 'SYNTHETIC_TEST');
  assert.equal(resolution.queryFirstRequired, true);
  assert.equal(resolution.blindResubmitAllowed, false);
  assert.equal(resolution.replacementClientOrderId, null);
  assert.equal(resolution.ordersPerformed, 0);

  const marketBuilt = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_CLOSE',
    existingClientOrderId: 'm1i1-perp-close-a1',
    type: 'MARKET',
  }));
  assert.equal(marketBuilt.ok, true);
  const marketResolution = adapter.normalizeOrderQueryEvidence(
    marketBuilt.intent,
    foundEvidence(marketBuilt.intent),
  );
  assert.equal(marketResolution.state, 'CONFIRMED');
  assert.equal(marketResolution.order.timeInForce, null);
  assert.equal(marketResolution.order.venueTimeInForce, 'GTC');
  assert.equal(marketResolution.order.closePosition, false);
});

test('query identity mismatch, unknown status and ambiguous outcomes remain unresolved', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);
  const mismatches = [
    { symbol: 'ETHUSDT' },
    { clientOrderId: 'different-existing-id' },
    { side: 'BUY' },
    { type: 'MARKET' },
    { origQty: '0.02' },
    { timeInForce: 'IOC' },
    { positionSide: 'SHORT' },
    { reduceOnly: true },
    { closePosition: true },
    { price: '50000.2' },
  ];
  for (const mismatch of mismatches) {
    const resolution = adapter.normalizeOrderQueryEvidence(
      built.intent,
      foundEvidence(built.intent, { order: mismatch }),
    );
    assert.equal(resolution.state, 'UNRESOLVED');
    assert.equal(
      resolution.blockingCodes.includes('QUERY_IDENTITY_MISMATCH'),
      true,
    );
    assert.equal(resolution.blindResubmitAllowed, false);
    assert.equal(resolution.replacementClientOrderId, null);
  }

  const unknownStatus = adapter.normalizeOrderQueryEvidence(
    built.intent,
    foundEvidence(built.intent, { order: { status: 'UNRECOGNIZED' } }),
  );
  assert.equal(unknownStatus.state, 'UNRESOLVED');
  assert.equal(
    unknownStatus.blockingCodes.includes('QUERY_STATUS_UNKNOWN'),
    true,
  );

  for (const outcome of [
    'NOT_FOUND',
    'TIMEOUT',
    'AMBIGUOUS',
    'RETENTION_EXPIRED',
  ]) {
    const unresolved = adapter.normalizeOrderQueryEvidence(
      built.intent,
      foundEvidence(built.intent, { outcome, omitOrder: true }),
    );
    assert.equal(unresolved.state, 'UNRESOLVED');
    assert.deepEqual(unresolved.blockingCodes, [
      'QUERY_OUTCOME_UNRESOLVED',
    ]);
    assert.equal(unresolved.queryFirstRequired, true);
    assert.equal(unresolved.blindResubmitAllowed, false);
    assert.equal(unresolved.replacementClientOrderId, null);
    assert.equal(unresolved.evidenceAuthority, 'SYNTHETIC_TEST');
  }
});

test('normalizes valid padded Binance response decimals before identity comparison', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);
  const padded = adapter.normalizeOrderQueryEvidence(
    built.intent,
    foundEvidence(built.intent, {
      order: {
        origQty: '0.01000000',
        executedQty: '0.01000000',
        price: '50000.10000000',
      },
    }),
  );
  assert.equal(padded.state, 'CONFIRMED');
  assert.equal(padded.order.origQty, '0.01');
  assert.equal(padded.order.executedQty, '0.01');
  assert.equal(padded.order.price, '50000.1');

  for (const signedZero of ['-0', '-0.00000000', '-00', '-00.000']) {
    const negativeZero = adapter.normalizeOrderQueryEvidence(
      built.intent,
      foundEvidence(built.intent, {
        order: { executedQty: signedZero },
      }),
    );
    assert.equal(negativeZero.state, 'UNRESOLVED', signedZero);
    assert.equal(
      negativeZero.blockingCodes.includes('QUERY_EVIDENCE_INVALID'),
      true,
      signedZero,
    );
  }
});

test('query status and cumulative fill must be mutually coherent', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);

  const coherent = [
    ['NEW', '0.00000000'],
    ['REJECTED', '0'],
    ['PARTIALLY_FILLED', '0.00500000'],
    ['CANCELED', '0.005'],
    ['EXPIRED', '0'],
    ['EXPIRED_IN_MATCH', '0.009'],
    ['FILLED', '0.01000000'],
  ];
  for (const [status, executedQty] of coherent) {
    const resolution = adapter.normalizeOrderQueryEvidence(
      built.intent,
      foundEvidence(built.intent, {
        order: { status, executedQty },
      }),
    );
    assert.equal(resolution.state, 'CONFIRMED', `${status}/${executedQty}`);
  }

  const incoherent = [
    ['FILLED', '0'],
    ['NEW', '0.001'],
    ['REJECTED', '0.001'],
    ['PARTIALLY_FILLED', '0'],
    ['PARTIALLY_FILLED', '0.01'],
    ['CANCELED', '0.01'],
    ['EXPIRED', '0.01'],
    ['EXPIRED_IN_MATCH', '0.01'],
  ];
  for (const [status, executedQty] of incoherent) {
    const resolution = adapter.normalizeOrderQueryEvidence(
      built.intent,
      foundEvidence(built.intent, {
        order: { status, executedQty },
      }),
    );
    assert.equal(
      resolution.state,
      'UNRESOLVED',
      `${status}/${executedQty}`,
    );
    assert.equal(
      resolution.blockingCodes.includes(
        'QUERY_STATUS_FILL_INCOHERENT',
      ),
      true,
      `${status}/${executedQty}`,
    );
  }
});

test('MARKET query evidence requires the venue zero-price sentinel', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput({
    leg: 'PERP_CLOSE',
    existingClientOrderId: 'm1i1-perp-close-market-a1',
    type: 'MARKET',
  }));
  assert.equal(built.ok, true);

  const zeroPrice = adapter.normalizeOrderQueryEvidence(
    built.intent,
    foundEvidence(built.intent, {
      order: { price: '0.00000000' },
    }),
  );
  assert.equal(zeroPrice.state, 'CONFIRMED');
  assert.equal(zeroPrice.order.price, '0');

  const nonZeroPrice = adapter.normalizeOrderQueryEvidence(
    built.intent,
    foundEvidence(built.intent, {
      order: { price: '1.00000000' },
    }),
  );
  assert.equal(nonZeroPrice.state, 'UNRESOLVED');
  assert.equal(
    nonZeroPrice.blockingCodes.includes('QUERY_IDENTITY_MISMATCH'),
    true,
  );
});

test('stale, future, live-private, malformed, and hostile query evidence stays unresolved', () => {
  const adapter = enabledAdapter();
  const built = adapter.buildOrderIntent(intentInput());
  assert.equal(built.ok, true);
  const cases = [
    [
      foundEvidence(built.intent, {
        observedAtMs: T0 - MAX_AGE_MS - 1,
        receivedAtMs: T0 - MAX_AGE_MS - 1,
      }),
      'QUERY_EVIDENCE_STALE',
    ],
    [
      foundEvidence(built.intent, { receivedAtMs: T0 + 1 }),
      'QUERY_EVIDENCE_FUTURE',
    ],
    [
      foundEvidence(built.intent, { authority: 'LIVE_PRIVATE' }),
      'QUERY_AUTHORITY_INVALID',
    ],
    [
      foundEvidence(built.intent, { maxAgeMs: 300_001 }),
      'QUERY_EVIDENCE_INVALID',
    ],
  ];
  for (const [evidence, expected] of cases) {
    const resolution = adapter.normalizeOrderQueryEvidence(
      built.intent,
      evidence,
    );
    assert.equal(resolution.state, 'UNRESOLVED');
    assert.deepEqual(resolution.blockingCodes, [expected]);
    assert.equal(resolution.evidenceAuthority, null);
  }

  let trapCalls = 0;
  const hostile = new Proxy({}, {
    get() {
      trapCalls += 1;
      throw new Error('must not run');
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error('must not run');
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('must not run');
    },
  });
  const resolution = adapter.normalizeOrderQueryEvidence(
    built.intent,
    hostile,
  );
  assert.equal(resolution.state, 'UNRESOLVED');
  assert.deepEqual(resolution.blockingCodes, ['QUERY_EVIDENCE_INVALID']);
  assert.equal(trapCalls, 0);
});

test('hostile config is inert and nominal guards reject proxies without traps', () => {
  let getterCalls = 0;
  const config = {};
  Object.defineProperty(config, 'enabled', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  const adapter = createBinanceUsdMBasisValidateOnlyAdapter(config);
  assert.equal(adapter.enabled, false);
  assert.equal(adapter.sourceEnabled, false);
  assert.equal(adapter.killSwitchEngaged, true);
  assert.equal(getterCalls, 0);

  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() {
      trapCalls += 1;
      return true;
    },
  });
  assert.equal(isBinanceUsdMBasisIntentResult(proxy), false);
  assert.equal(isBinanceUsdMBasisWireIntent(proxy), false);
  assert.equal(isBinanceUsdMBasisQueryDescriptorResult(proxy), false);
  assert.equal(isBinanceUsdMBasisQueryDescriptor(proxy), false);
  assert.equal(isBinanceUsdMBasisQueryResolution(proxy), false);
  assert.equal(trapCalls, 0);
});
