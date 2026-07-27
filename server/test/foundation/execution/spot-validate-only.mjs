import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as executionBarrel from '../../../dist/foundation/execution/index.js';
import {
  DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
  MAX_SPOT_PUBLIC_FILTER_AGE_MS,
  SPOT_PUBLIC_FILTER_EVIDENCE_SCHEMA,
  SPOT_PUBLIC_FILTER_SOURCE,
  SPOT_VALIDATE_ONLY_CAPABILITIES,
  SPOT_VENUE_EVIDENCE_SCHEMA,
  SPOT_VENUE_EVIDENCE_SOURCE,
  createSpotValidateOnlySeam,
} from '../../../dist/foundation/execution/spotValidateOnly.js';
import {
  SPOT_RISK_EVIDENCE_SCHEMA,
} from '../../../dist/foundation/execution/spotCore.js';
import {
  createSpotExecutionTicket,
} from '../../../dist/foundation/execution/spotTicket.js';

const NOW = 100_000;
const TEST_SYMBOL = 'TESTUSDT';
const FILTERS = Object.freeze([
  Object.freeze({
    filterType: 'PRICE_FILTER',
    minPrice: '0.01',
    maxPrice: '1000000',
    tickSize: '0.01',
  }),
  Object.freeze({
    filterType: 'LOT_SIZE',
    minQty: '0.001',
    maxQty: '1000',
    stepSize: '0.001',
  }),
  Object.freeze({
    filterType: 'MIN_NOTIONAL',
    minNotional: '1',
    applyToMarket: true,
    avgPriceMins: 5,
  }),
]);

const PERCENT_PRICE_BY_SIDE = Object.freeze({
  filterType: 'PERCENT_PRICE_BY_SIDE',
  bidMultiplierUp: '1.2',
  bidMultiplierDown: '0.8',
  askMultiplierUp: '1.5',
  askMultiplierDown: '0.5',
  avgPriceMins: 5,
});

function ticket(overrides = {}) {
  return createSpotExecutionTicket({
    correlationId: 'correlation-spot-validate-only-1',
    planId: 'plan-spot-validate-only-1',
    accountId: 'account-spot-validate-only-1',
    symbol: TEST_SYMBOL,
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.1',
    price: '100',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '1',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10_000,
    ...overrides,
  });
}

function riskEvidence(value, overrides = {}) {
  return {
    schema: SPOT_RISK_EVIDENCE_SCHEMA,
    verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER',
    evidenceRevision: 'risk-evidence-revision-validate-only-1',
    policyRevision: 'risk-policy-revision-validate-only-1',
    policy: {
      minOrderNotionalQuote: '1',
      maxOrderNotionalQuote: '10',
      maxLossPerOrderQuote: '2',
      maxDailyLossQuote: '10',
    },
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    accountId: value.accountId,
    symbol: value.symbol,
    observedAtMs: NOW - 500,
    validUntilMs: NOW + 9_000,
    killSwitchEngaged: false,
    realizedDailyLossQuote: '0',
    riskReduction: null,
    ...overrides,
  };
}

function publicFilterEvidence(overrides = {}) {
  return {
    schema: SPOT_PUBLIC_FILTER_EVIDENCE_SCHEMA,
    source: SPOT_PUBLIC_FILTER_SOURCE,
    verification: 'VERIFIED_BY_PUBLIC_FILTER_OWNER',
    revision: 'exchange-info-public-revision-1',
    symbol: TEST_SYMBOL,
    quoteAsset: 'USDT',
    tradingStatus: 'TRADING',
    spotTradingAllowed: true,
    orderTypes: ['LIMIT', 'MARKET'],
    observedAtMs: NOW - 600,
    validUntilMs: NOW + 1_000,
    filters: FILTERS,
    ...overrides,
  };
}

function venueEvidence(overrides = {}) {
  return {
    schema: SPOT_VENUE_EVIDENCE_SCHEMA,
    source: SPOT_VENUE_EVIDENCE_SOURCE,
    verification: 'VERIFIED_BY_PUBLIC_SPOT_EVIDENCE_OWNER',
    revision: 'venue-public-evidence-revision-1',
    symbol: TEST_SYMBOL,
    observedAtMs: NOW - 400,
    validUntilMs: NOW + 1_000,
    referencePrice: {
      state: 'SET',
      price: '100',
      providerTimestampMs: NOW - 500,
    },
    fallbackPrices: [],
    executionRules: [],
    ...overrides,
  };
}

function enabledConfig(overrides = {}) {
  return {
    ...DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
    sourceEnabled: true,
    killSwitchEngaged: false,
    allowedSymbols: [TEST_SYMBOL],
    blockedSymbols: [],
    approvedUsdQuoteAssets: ['USDT'],
    maximumFilterAgeMs: MAX_SPOT_PUBLIC_FILTER_AGE_MS,
    ...overrides,
  };
}

function input(value = ticket(), overrides = {}) {
  return {
    nowMs: NOW,
    ticket: value,
    riskEvidence: riskEvidence(value),
    publicFilterEvidence: publicFilterEvidence(),
    venueExecutionEvidence: venueEvidence(),
    ...overrides,
  };
}

test('default seam is closed before reading any caller input', () => {
  const seam = createSpotValidateOnlySeam();
  let reads = 0;
  const hostileInput = new Proxy({}, {
    get() {
      reads += 1;
      throw new Error('default-off seam read caller input');
    },
  });
  const result = seam.validate(hostileInput);

  assert.equal(seam.mode, 'VALIDATE_ONLY');
  assert.equal(seam.sourceEnabled, false);
  assert.equal(reads, 0);
  assert.deepEqual(result.blockingCodes, ['SOURCE_DISABLED']);
  assert.equal(result.localValidationPassed, false);
  assert.equal(result.sideEffectsPerformed, 0);
  assert.equal(result.sendsPerformed, 0);
  assert.equal(Object.isFrozen(result), true);
});

test('engaged or unknown kill switch blocks before reading caller input', () => {
  for (const killSwitchEngaged of [true, null]) {
    const seam = createSpotValidateOnlySeam(
      enabledConfig({ killSwitchEngaged }),
    );
    let reads = 0;
    const result = seam.validate(new Proxy({}, {
      get() {
        reads += 1;
        throw new Error('closed kill switch read caller input');
      },
    }));
    assert.equal(reads, 0);
    assert.deepEqual(
      result.blockingCodes,
      ['KILL_SWITCH_ENGAGED_OR_UNKNOWN'],
    );
    assert.equal(result.localValidationPassed, false);
    assert.equal(result.sendsPerformed, 0);
    assert.equal(result.sideEffectsPerformed, 0);
    assert.equal(result.externalActionAuthorization, 'NONE');
    assert.deepEqual(result.permittedExternalActions, []);
    assert.equal('intent' in result, false);
  }
});

test('enabled seam converts hostile caller access into a closed result', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  let reads = 0;
  const hostileInput = new Proxy({}, {
    get() {
      reads += 1;
      throw new Error('hostile enabled input getter');
    },
  });

  assert.doesNotThrow(() => seam.validate(hostileInput));
  const result = seam.validate(hostileInput);
  assert.equal(reads, 2);
  assert.deepEqual(result.blockingCodes, ['INPUT_INVALID']);
  assert.equal(result.sideEffectsPerformed, 0);
  assert.equal(result.sendsPerformed, 0);
});

test('config and public filter evidence are snapshotted exactly once', () => {
  const mutableConfig = enabledConfig();
  const seam = createSpotValidateOnlySeam(mutableConfig);
  mutableConfig.killSwitchEngaged = true;
  mutableConfig.maximumFilterAgeMs = 1;
  mutableConfig.allowedSymbols.length = 0;
  mutableConfig.blockedSymbols.push(TEST_SYMBOL);
  mutableConfig.approvedUsdQuoteAssets.length = 0;

  let evidenceReads = 0;
  const supplied = input();
  Object.defineProperty(supplied, 'publicFilterEvidence', {
    enumerable: true,
    get() {
      evidenceReads += 1;
      return evidenceReads === 1
        ? publicFilterEvidence()
        : publicFilterEvidence({
            symbol: 'OTHERUSDT',
            tradingStatus: 'BREAK',
          });
    },
  });
  const result = seam.validate(supplied);

  assert.equal(evidenceReads, 1);
  assert.equal(result.localValidationPassed, true);
  assert.deepEqual(result.blockingCodes, []);
});

test('valid local evidence passes without exposing any external action intent', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const value = ticket();
  const first = seam.validate(input(value));
  const second = seam.validate(input(value));

  assert.deepEqual(first, second);
  assert.equal(first.localValidationPassed, true);
  assert.deepEqual(first.blockingCodes, []);
  assert.equal(first.filterValidation?.notional, '10');
  assert.equal(first.riskVerdict?.orderNotionalQuote, '10');
  assert.equal(first.ticketId, value.ticketId);
  assert.equal(first.clientOrderId, value.clientOrderId);
  assert.equal(first.ownerOrderNotionalCeilingQuote, '10');
  assert.equal(first.signedTestRequired, true);
  assert.equal(first.signedTestPerformed, false);
  assert.equal(first.signedTestIntentExposed, false);
  assert.equal(first.liveSendAuthorized, false);
  assert.equal(first.externalActionAuthorization, 'NONE');
  assert.deepEqual(first.permittedExternalActions, []);
  assert.deepEqual(first.capabilities, SPOT_VALIDATE_ONLY_CAPABILITIES);
  assert.equal(Object.values(first.capabilities).filter(Boolean).length, 1);
  assert.equal(first.capabilities.localValidation, true);
  for (const capability of [
    'signedTestOrder',
    'liveOrder',
    'orderQuery',
    'cancelOrder',
    'withdrawal',
    'transfer',
    'borrow',
    'repay',
  ]) {
    assert.equal(first.capabilities[capability], false);
  }
  assert.equal('signedTestIntent' in first, false);
  assert.equal('intent' in first, false);
  assert.doesNotMatch(
    JSON.stringify(first),
    /SIGNED_TEST_ORDER|SUBMIT_LIVE_ORDER/u,
  );
});

test('allowlist, deny policy, and approved USD quote policy fail closed', () => {
  const value = ticket();
  const empty = createSpotValidateOnlySeam(
    enabledConfig({ allowedSymbols: [] }),
  ).validate(input(value));
  assert.deepEqual(empty.blockingCodes, ['SYMBOL_NOT_ALLOWLISTED']);
  assert.equal(empty.localValidationPassed, false);
  assert.equal(empty.sendsPerformed, 0);
  assert.equal(empty.sideEffectsPerformed, 0);
  assert.equal(empty.externalActionAuthorization, 'NONE');
  assert.deepEqual(empty.permittedExternalActions, []);
  assert.equal('intent' in empty, false);

  const other = createSpotValidateOnlySeam(
    enabledConfig({ allowedSymbols: ['OTHERUSDT'] }),
  ).validate(input(value));
  assert.ok(other.blockingCodes.includes('SYMBOL_NOT_ALLOWLISTED'));

  const blocked = createSpotValidateOnlySeam(
    enabledConfig({ blockedSymbols: [TEST_SYMBOL] }),
  ).validate(input(value));
  assert.ok(blocked.blockingCodes.includes('SYMBOL_BLOCKED'));

  const quote = createSpotValidateOnlySeam(
    enabledConfig({ approvedUsdQuoteAssets: [] }),
  ).validate(input(value));
  assert.ok(
    quote.blockingCodes.includes('PUBLIC_FILTER_QUOTE_ASSET_NOT_APPROVED'),
  );
});

test('public filter evidence binds symbol, freshness, trading state, and order type', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const value = ticket();

  const mismatch = seam.validate(input(value, {
    publicFilterEvidence: publicFilterEvidence({ symbol: 'OTHERUSDT' }),
  }));
  assert.ok(
    mismatch.blockingCodes.includes('PUBLIC_FILTER_SYMBOL_MISMATCH'),
  );

  const stale = seam.validate(input(value, {
    publicFilterEvidence: publicFilterEvidence({
      observedAtMs: NOW - MAX_SPOT_PUBLIC_FILTER_AGE_MS - 1,
      validUntilMs: NOW + 1,
    }),
  }));
  assert.ok(stale.blockingCodes.includes('PUBLIC_FILTER_STALE'));

  const halted = seam.validate(input(value, {
    publicFilterEvidence: publicFilterEvidence({
      tradingStatus: 'BREAK',
    }),
  }));
  assert.ok(
    halted.blockingCodes.includes('PUBLIC_FILTER_TRADING_DISABLED'),
  );

  const unsupported = seam.validate(input(value, {
    publicFilterEvidence: publicFilterEvidence({
      orderTypes: ['MARKET'],
    }),
  }));
  assert.ok(
    unsupported.blockingCodes.includes(
      'PUBLIC_FILTER_ORDER_TYPE_UNSUPPORTED',
    ),
  );
});

test('canonical ticket identity and exact ten-unit ceiling cannot be forged', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const exact = ticket();
  assert.equal(seam.validate(input(exact)).localValidationPassed, true);

  const forged = { ...exact, clientOrderId: `${exact.clientOrderId}x` };
  assert.deepEqual(
    seam.validate(input(forged)).blockingCodes,
    ['TICKET_INVALID'],
  );

  const above = ticket({ quantity: '0.1001' });
  const result = seam.validate(input(above, {
    riskEvidence: riskEvidence(above),
  }));
  assert.equal(result.localValidationPassed, false);
  assert.ok(result.blockingCodes.includes('RISK_POLICY_BLOCKED'));
  assert.equal(
    result.riskVerdict?.blockingCodes.includes('ORDER_NOTIONAL_MAX'),
    true,
  );

  const forgedPolicy = seam.validate(input(exact, {
    riskEvidence: riskEvidence(exact, {
      policy: {
        minOrderNotionalQuote: '1',
        maxOrderNotionalQuote: '10.0000000000000000001',
        maxLossPerOrderQuote: '2',
        maxDailyLossQuote: '10',
      },
    }),
  }));
  assert.equal(forgedPolicy.localValidationPassed, false);
  assert.ok(forgedPolicy.blockingCodes.includes('RISK_POLICY_BLOCKED'));
  assert.deepEqual(forgedPolicy.riskVerdict?.blockingCodes, ['POLICY_VALID']);
});

test('default configuration keeps every action capability absent', () => {
  assert.equal(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.sourceEnabled, false);
  assert.equal(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.killSwitchEngaged, true);
  assert.deepEqual(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.allowedSymbols, []);
  assert.deepEqual(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.blockedSymbols, []);
  assert.deepEqual(
    DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.approvedUsdQuoteAssets,
    [],
  );
  assert.equal(
    Object.values(SPOT_VALIDATE_ONLY_CAPABILITIES).filter(Boolean).length,
    1,
  );
  assert.equal(SPOT_VALIDATE_ONLY_CAPABILITIES.localValidation, true);
});

test('venue execution evidence is mandatory and answers reference-first filters', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const value = ticket();
  const evidence = publicFilterEvidence({
    filters: [...FILTERS, PERCENT_PRICE_BY_SIDE],
  });

  const missing = seam.validate(
    input(value, { venueExecutionEvidence: null }),
  );
  assert.equal(missing.localValidationPassed, false);
  assert.deepEqual(missing.blockingCodes, ['VENUE_EVIDENCE_INVALID']);
  assert.equal(missing.filterValidation, null);
  assert.equal(missing.venueEvidenceRevision, null);

  const validated = seam.validate(
    input(value, {
      publicFilterEvidence: evidence,
    }),
  );
  assert.equal(validated.localValidationPassed, true);
  assert.deepEqual(validated.blockingCodes, []);
  assert.equal(
    validated.venueEvidenceRevision,
    'venue-public-evidence-revision-1',
  );
  assert.equal(validated.signedTestRequired, true);
  assert.equal(validated.signedTestPerformed, false);
  assert.equal(validated.liveSendAuthorized, false);
  assert.equal(validated.externalActionAuthorization, 'NONE');
  assert.deepEqual(validated.permittedExternalActions, []);

  // A null reference price is what opens the window-bound fallback.
  const fallback = seam.validate(
    input(value, {
      publicFilterEvidence: evidence,
      venueExecutionEvidence: venueEvidence({
        referencePrice: {
          state: 'NULL',
          providerTimestampMs: NOW - 550,
        },
        fallbackPrices: [{
          basis: 'VWAP',
          price: '100',
          windowMins: 5,
          providerCloseTimeMs: NOW - 500,
        }],
      }),
    }),
  );
  assert.equal(fallback.localValidationPassed, true);

  const wrongWindow = seam.validate(
    input(value, {
      publicFilterEvidence: evidence,
      venueExecutionEvidence: venueEvidence({
        referencePrice: {
          state: 'NEVER_SET',
          errorCode: -2043,
        },
        fallbackPrices: [{
          basis: 'VWAP',
          price: '100',
          windowMins: 1,
          providerCloseTimeMs: NOW - 500,
        }],
      }),
    }),
  );
  assert.equal(wrongWindow.localValidationPassed, false);
  assert.deepEqual(
    wrongWindow.filterValidation.failures.map((item) => item.code),
    ['MISSING_PERCENT_PRICE_REFERENCE'],
  );
});

test('provider-shaped executionRules and referencePrice map to compatibility-only state', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const value = ticket();
  const rawExecutionRules = Object.freeze({
    symbolRules: Object.freeze([
      Object.freeze({
        symbol: TEST_SYMBOL,
        rules: Object.freeze([
          Object.freeze({
            ruleType: 'PRICE_RANGE',
            bidLimitMultUp: '1.1500',
            bidLimitMultDown: '0.8500',
            askLimitMultUp: '1.1500',
            askLimitMultDown: '0.8500',
          }),
        ]),
      }),
    ]),
  });
  const rawReferencePrice = Object.freeze({
    symbol: TEST_SYMBOL,
    referencePrice: '100.00000000',
    timestamp: NOW - 500,
  });
  const symbolRules = rawExecutionRules.symbolRules.find(
    (entry) => entry.symbol === value.symbol,
  );
  assert.ok(symbolRules);
  assert.equal(rawReferencePrice.symbol, value.symbol);

  const result = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        referencePrice: {
          state: 'SET',
          price: rawReferencePrice.referencePrice,
          providerTimestampMs: rawReferencePrice.timestamp,
        },
        executionRules: symbolRules.rules,
      }),
    }),
  );

  assert.equal(result.localValidationPassed, true);
  assert.deepEqual(result.filterValidation.priceRange, {
    rulePresent: true,
    side: 'BUY',
    limitMultiplierDown: '0.85',
    limitMultiplierUp: '1.15',
    referencePriceState: 'SET',
    enforcementPhase: 'TAKER_EXECUTION',
    outOfRangeOutcome: 'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED',
    venueAcceptance: 'NOT_CLAIMED',
  });
  assert.equal(result.signedTestRequired, true);
  assert.equal(result.signedTestIntentExposed, false);
  assert.equal(result.sendsPerformed, 0);
  assert.equal(result.sideEffectsPerformed, 0);

  // The same endpoint answers a null reference price when none is published,
  // and no filter here needs one, so no fallback window is required either.
  const rawNullReferencePrice = Object.freeze({
    symbol: TEST_SYMBOL,
    referencePrice: null,
    timestamp: NOW - 500,
  });
  assert.equal(rawNullReferencePrice.referencePrice, null);
  const nullReference = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        referencePrice: {
          state: 'NULL',
          providerTimestampMs: rawNullReferencePrice.timestamp,
        },
        executionRules: symbolRules.rules,
      }),
    }),
  );
  assert.equal(nullReference.localValidationPassed, true);
  assert.equal(
    nullReference.filterValidation.priceRange.referencePriceState,
    'NULL',
  );

  const unsupported = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        executionRules: [{ ruleType: 'FUTURE_RULE' }],
      }),
    }),
  );
  assert.equal(unsupported.localValidationPassed, false);
  assert.deepEqual(
    unsupported.filterValidation.failures.map((item) => item.code),
    ['PRICE_RANGE_RULE_UNSUPPORTED'],
  );

  const duplicate = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        executionRules: [symbolRules.rules[0], symbolRules.rules[0]],
      }),
    }),
  );
  assert.equal(
    duplicate.filterValidation.failures.some(
      (item) => item.code === 'PRICE_RANGE_RULE_DUPLICATE',
    ),
    true,
  );

  const evolved = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        executionRules: [{ ...symbolRules.rules[0], futureBound: '1' }],
      }),
    }),
  );
  assert.equal(
    evolved.filterValidation.failures.some(
      (item) => item.code === 'PRICE_RANGE_EVIDENCE_INVALID',
    ),
    true,
  );
});

test('venue execution evidence binds schema, symbol, and freshness', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  const value = ticket();

  for (const override of [
    { schema: 'cosmos.foundation.spot-venue-execution-evidence.v2' },
    { source: 'CALLER_SUPPLIED' },
    { verification: 'ASSUMED' },
    { revision: '' },
    { symbol: 'lowercase' },
    { observedAtMs: -1 },
    { referencePrice: 7 },
    { referencePrice: { state: 'SET', price: '0', providerTimestampMs: NOW } },
    { referencePrice: { state: 'NEVER_SET', errorCode: -1121 } },
    { fallbackPrices: 'VWAP' },
    // A live reference price and a fallback cannot both be in force.
    {
      fallbackPrices: [{
        basis: 'VWAP',
        price: '100',
        windowMins: 5,
        providerCloseTimeMs: NOW - 500,
      }],
    },
    { executionRules: 'PRICE_RANGE' },
    { futureField: true },
  ]) {
    const result = seam.validate(
      input(value, { venueExecutionEvidence: venueEvidence(override) }),
    );
    assert.deepEqual(
      result.blockingCodes,
      ['VENUE_EVIDENCE_INVALID'],
      JSON.stringify(override),
    );
  }

  const mismatch = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({ symbol: 'OTHERUSDT' }),
    }),
  );
  assert.deepEqual(mismatch.blockingCodes, ['VENUE_EVIDENCE_SYMBOL_MISMATCH']);
  assert.equal(
    mismatch.venueEvidenceRevision,
    'venue-public-evidence-revision-1',
  );

  for (const override of [
    { observedAtMs: NOW + 1 },
    { validUntilMs: NOW },
    {
      validUntilMs:
        NOW - 400 + MAX_SPOT_PUBLIC_FILTER_AGE_MS + 1,
    },
    {
      referencePrice: {
        state: 'SET',
        price: '100',
        providerTimestampMs: NOW - 399,
      },
    },
    {
      referencePrice: {
        state: 'SET',
        price: '100',
        providerTimestampMs: NOW - MAX_SPOT_PUBLIC_FILTER_AGE_MS - 1,
      },
    },
    // Fallback windows carry their own provider times and age the same way.
    {
      referencePrice: { state: 'NULL', providerTimestampMs: NOW - 500 },
      fallbackPrices: [{
        basis: 'VWAP',
        price: '100',
        windowMins: 5,
        providerCloseTimeMs: NOW - MAX_SPOT_PUBLIC_FILTER_AGE_MS - 1,
      }],
    },
  ]) {
    const stale = seam.validate(
      input(value, { venueExecutionEvidence: venueEvidence(override) }),
    );
    assert.deepEqual(stale.blockingCodes, ['VENUE_EVIDENCE_STALE']);
  }

  const exactBoundary = seam.validate(
    input(value, {
      venueExecutionEvidence: venueEvidence({
        observedAtMs: NOW - MAX_SPOT_PUBLIC_FILTER_AGE_MS + 1,
        validUntilMs: NOW + 1,
        referencePrice: {
          state: 'SET',
          price: '100',
          providerTimestampMs: NOW - MAX_SPOT_PUBLIC_FILTER_AGE_MS,
        },
      }),
    }),
  );
  assert.equal(exactBoundary.localValidationPassed, true);
  assert.deepEqual(exactBoundary.blockingCodes, []);
});

test('venue execution evidence is snapshotted exactly once', () => {
  const seam = createSpotValidateOnlySeam(enabledConfig());
  let reads = 0;
  const supplied = input();
  Object.defineProperty(supplied, 'venueExecutionEvidence', {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1
        ? venueEvidence()
        : venueEvidence({ symbol: 'OTHERUSDT' });
    },
  });
  const result = seam.validate(supplied);

  assert.equal(reads, 1);
  assert.equal(result.localValidationPassed, true);
  assert.deepEqual(result.blockingCodes, []);
});

test('shared barrel exposes only the validate-only Spot seam', () => {
  assert.equal(
    executionBarrel.createSpotValidateOnlySeam,
    createSpotValidateOnlySeam,
  );
  for (const forbidden of [
    'prepareSpotCore',
    'decideSpotLiveSend',
    'decideSpotAttempt',
    'createSpotExecutionTicket',
    'BinanceSpotExecutionPort',
  ]) {
    assert.equal(forbidden in executionBarrel, false);
  }
});

test('compiled seam contains no effectful or money-moving dependency', () => {
  const source = readFileSync(
    new URL(
      '../../../dist/foundation/execution/spotValidateOnly.js',
      import.meta.url,
    ),
    'utf8',
  );
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
  for (const forbidden of [
    /\bfetch\s*\(/u,
    /process\.env/u,
    /Date\.now/u,
    /Math\.random/u,
    /node:(?:fs|https?|net|timers)/u,
    /ledger/u,
    /privateRead/u,
    /spotPort/u,
    /decideSpotLiveSend/u,
    /decideSpotAttempt/u,
    /withdraw\s*\(/iu,
    /transfer\s*\(/iu,
    /borrow\s*\(/iu,
    /repay\s*\(/iu,
  ]) {
    assert.doesNotMatch(codeOnly, forbidden);
  }
});
