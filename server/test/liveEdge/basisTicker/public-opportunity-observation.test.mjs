#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildPublicBasisOpportunityObservation,
  decodePublicBasisOpportunityObservation,
  isPublicBasisOpportunityObservation,
  validatePublicBasisOpportunityObservation,
} from '../../../dist/engine/basis/publicOpportunityObservation.js';
import { canonicalJson } from '../../../dist/foundation/contracts/identity.js';

const OPPORTUNITY_CREATED_AT_MS = 1_500;
const OBSERVED_AT_MS = 2_000;
const EVALUATED_AT_MS = 2_010;

function provenance(overrides = {}) {
  return {
    authority: 'CONFIG_ASSUMPTION',
    sourceId: 'basis-observation-test-config',
    revision: 'config-v1',
    sourceEventAtMs: null,
    sourceTransactionAtMs: null,
    receivedAtMs: null,
    expiresAtMs: null,
    timeBasis: 'NOT_APPLICABLE',
    ...overrides,
  };
}

function component(valuePct, overrides = {}) {
  return {
    state: 'PUBLIC_SCHEDULE_ASSUMPTION',
    valuePct,
    provenance: provenance({
      authority: 'BINANCE_PUBLIC',
      sourceId: 'binance.public.fee-schedule',
      revision: 'fee-schedule-v1',
      sourceTransactionAtMs: 1_980,
      receivedAtMs: 1_988,
      expiresAtMs: 2_500,
      timeBasis: 'SOURCE_TRANSACTION_TIME',
    }),
    reasonCodes: [],
    ...overrides,
  };
}

function spotQuote(overrides = {}) {
  return {
    market: 'SPOT',
    bidPrice: '99.98',
    askPrice: '100',
    bidQuantity: '25',
    askQuantity: '24',
    state: 'OBSERVED_PUBLIC',
    provenance: provenance({
      authority: 'BINANCE_PUBLIC',
      sourceId: 'binance.public.spot.bookTicker',
      revision: 'spot-book-cut-1',
      receivedAtMs: 1_990,
      expiresAtMs: 2_500,
      timeBasis: 'RECEIPT_TIME',
    }),
    reasonCodes: [],
    ...overrides,
  };
}

function perpetualQuote(overrides = {}) {
  return {
    market: 'USD_M_PERPETUAL',
    bidPrice: '102',
    askPrice: '102.02',
    bidQuantity: '30',
    askQuantity: '29',
    state: 'OBSERVED_PUBLIC',
    provenance: provenance({
      authority: 'BINANCE_PUBLIC',
      sourceId: 'binance.public.usdm.bookTicker',
      revision: 'perpetual-book-cut-1',
      sourceEventAtMs: 1_985,
      sourceTransactionAtMs: 1_987,
      receivedAtMs: 1_995,
      expiresAtMs: 2_500,
      timeBasis: 'SOURCE_TRANSACTION_TIME',
    }),
    reasonCodes: [],
    ...overrides,
  };
}

function baseInput() {
  return {
    opportunityId: 'basis-opportunity-1',
    opportunityCreatedAtMs: OPPORTUNITY_CREATED_AT_MS,
    correlationId: 'basis-correlation-1',
    sourceCutId: 'public-cut-1',
    symbol: 'TESTUSDT',
    direction: 'long_spot_short_perp',
    ownerDecisionKind: 'proposal',
    observedAtMs: OBSERVED_AT_MS,
    evaluatedAtMs: EVALUATED_AT_MS,
    ownerReportedGrossEdgePct: '2',
    ownerReportedNetEdgePct: '1.8',
    quoteCut: {
      spot: spotQuote(),
      perpetual: perpetualQuote(),
      maxQuoteAgeMs: 100,
      maxReceiptSkewMs: 10,
    },
    costs: {
      spotOpenFee: component('0.025'),
      spotCloseFee: component('0.025'),
      perpetualOpenFee: component('0.025'),
      perpetualCloseFee: component('0.025'),
      slippage: component('0.1', {
        state: 'MODEL_ASSUMPTION',
        provenance: provenance({
          authority: 'PUBLIC_MODEL',
          sourceId: 'basis-public-slippage-model',
          revision: 'slippage-v1',
          receivedAtMs: 1_988,
          expiresAtMs: 2_500,
          timeBasis: 'RECEIPT_TIME',
        }),
      }),
      fundingCarry: component('0.02', {
        state: 'DERIVED_PUBLIC',
        provenance: provenance({
          authority: 'PUBLIC_MODEL',
          sourceId: 'binance.public.funding-projection',
          revision: 'funding-cut-1',
          sourceEventAtMs: 1_980,
          sourceTransactionAtMs: 1_982,
          receivedAtMs: 1_988,
          expiresAtMs: 2_500,
          timeBasis: 'SOURCE_TRANSACTION_TIME',
        }),
      }),
      borrowCost: component('0', {
        state: 'NOT_REQUIRED',
        provenance: provenance({
          authority: 'NONE',
          sourceId: null,
          revision: null,
        }),
      }),
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function expectedDigest(observation) {
  const {
    observationId: _observationId,
    contentDigestSha256: _contentDigestSha256,
    ...content
  } = observation;
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
}

function expectedObservationId(input) {
  const digest = createHash('sha256').update(canonicalJson({
    schema: 'cosmos.engine.basis.public-opportunity-observation',
    version: 1,
    opportunityId: input.opportunityId,
    opportunityCreatedAtMs: input.opportunityCreatedAtMs,
    correlationId: input.correlationId,
    sourceCutId: input.sourceCutId,
    symbol: input.symbol,
    direction: input.direction,
    ownerDecisionKind: input.ownerDecisionKind,
    observedAtMs: input.observedAtMs,
  }), 'utf8').digest('hex');
  return `basisobs_${digest.slice(0, 32)}`;
}

test('public observation identity, exact proxy economics, and canonical bytes are deterministic', () => {
  const input = baseInput();
  const first = buildPublicBasisOpportunityObservation(input);
  const second = buildPublicBasisOpportunityObservation(clone(input));

  assert.deepEqual(second, first);
  assert.equal(first.contentDigestSha256, expectedDigest(first));
  assert.equal(first.observationId, expectedObservationId(input));
  assert.match(first.contentDigestSha256, /^[a-f0-9]{64}$/);

  assert.equal(first.economics.grossExecutableEdgePct, '2');
  assert.equal(first.economics.grossExecutableEdgeState, 'PUBLIC_TOP_OF_BOOK');
  assert.equal(first.economics.ownerReportedGrossEdgePct, '2');
  assert.equal(first.economics.ownerReportedNetEdgePct, '1.8');
  assert.equal(first.economics.configuredProxyNetEdgePct, '1.82');
  assert.equal(first.economics.configuredProxyNetState, 'ASSUMPTION_BOUND');
  assert.equal(first.economics.configuredProxyNetEdgeUsdPerOneThousandNotional, '18.2');
  assert.equal(first.economics.accountEffectiveNetEdgePct, null);
  assert.equal(first.economics.accountEffectiveNetState, 'UNKNOWN');
  assert.deepEqual(first.edgeComputationPolicy, {
    arithmetic: 'EXACT_BASE_10',
    divisionScale: 18,
    divisionRounding: 'TRUNCATE_TOWARD_ZERO',
  });
  assert.equal(first.releaseState, 'NOT_CONFIGURED');
  assert.equal(first.executionAuthority, 'NONE');
  assert.equal(first.measurementMeaning, 'PUBLIC_OBSERVED_PROXY_NOT_EXECUTED');
  assert.deepEqual(validatePublicBasisOpportunityObservation(first), []);
  assert.equal(isPublicBasisOpportunityObservation(first), true);

  const decoded = decodePublicBasisOpportunityObservation(clone(first));
  assert.notEqual(decoded, null);
  assert.deepEqual(decoded, first);
  assert.equal(
    Buffer.compare(
      Buffer.from(canonicalJson(decoded), 'utf8'),
      Buffer.from(canonicalJson(first), 'utf8'),
    ),
    0,
  );
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.economics), true);
  assert.equal(Object.isFrozen(decoded.quoteCut.spot.provenance), true);
});

test('incomplete cost provenance keeps the configured proxy and per-$1k value UNKNOWN', () => {
  const fixtures = [
    {
      label: 'missing fee revision',
      mutate(input) {
        input.costs.spotOpenFee.provenance.revision = null;
      },
    },
    ...['spotCloseFee', 'slippage', 'fundingCarry'].map((field) => ({
      label: `missing ${field} receipt time`,
      mutate(input) {
        input.costs[field].provenance.receivedAtMs = null;
      },
    })),
  ];

  for (const fixture of fixtures) {
    const input = baseInput();
    fixture.mutate(input);
    const observation = buildPublicBasisOpportunityObservation(input);

    assert.equal(
      observation.economics.grossExecutableEdgePct,
      '2',
      fixture.label,
    );
    assert.equal(observation.economics.grossExecutableEdgeState, 'PUBLIC_TOP_OF_BOOK');
    assert.equal(observation.economics.configuredProxyNetState, 'UNKNOWN', fixture.label);
    assert.equal(observation.economics.configuredProxyNetEdgePct, null);
    assert.equal(observation.economics.configuredProxyNetEdgeUsdPerOneThousandNotional, null);
    assert.equal(observation.economics.accountEffectiveNetState, 'UNKNOWN');
    assert.equal(observation.economics.accountEffectiveNetEdgePct, null);
    assert.ok(
      observation.reasonCodes.includes('MODELED_COST_PROVENANCE_INCOMPLETE'),
      fixture.label,
    );
    assert.deepEqual(validatePublicBasisOpportunityObservation(observation), []);
  }
});

test('reverse basis remains UNKNOWN while private borrow truth is unavailable', () => {
  const input = baseInput();
  input.direction = 'short_spot_long_perp';
  input.quoteCut.spot = spotQuote({
    bidPrice: '102',
    askPrice: '102.02',
  });
  input.quoteCut.perpetual = perpetualQuote({
    bidPrice: '99.98',
    askPrice: '100',
  });
  input.costs.borrowCost = component(null, {
    state: 'UNKNOWN',
    provenance: provenance({
      authority: 'UNKNOWN',
      sourceId: null,
      revision: null,
      timeBasis: 'UNKNOWN',
    }),
    reasonCodes: ['PRIVATE_BORROW_NOT_OBSERVED'],
  });

  const observation = buildPublicBasisOpportunityObservation(input);

  assert.equal(observation.economics.grossExecutableEdgePct, '2');
  assert.equal(observation.economics.grossExecutableEdgeState, 'PUBLIC_TOP_OF_BOOK');
  assert.equal(observation.economics.configuredProxyNetState, 'UNKNOWN');
  assert.equal(observation.economics.configuredProxyNetEdgePct, null);
  assert.equal(observation.economics.configuredProxyNetEdgeUsdPerOneThousandNotional, null);
  assert.ok(observation.reasonCodes.includes('REVERSE_BASIS_BORROW_PRIVATE_UNKNOWN'));
  assert.equal(observation.economics.accountEffectiveNetState, 'UNKNOWN');
  assert.deepEqual(validatePublicBasisOpportunityObservation(observation), []);
});

test('Spot receipt-time provenance is explicit and stale, future, or invalid public quotes are rejected', () => {
  const observation = buildPublicBasisOpportunityObservation(baseInput());

  assert.equal(observation.sourceAuthority, 'PUBLIC_ONLY');
  assert.equal(observation.quoteCut.spot.provenance.authority, 'BINANCE_PUBLIC');
  assert.equal(observation.quoteCut.spot.provenance.timeBasis, 'RECEIPT_TIME');
  assert.equal(observation.quoteCut.spot.provenance.sourceEventAtMs, null);
  assert.equal(observation.quoteCut.spot.provenance.sourceTransactionAtMs, null);
  assert.equal(observation.quoteCut.spot.provenance.receivedAtMs, 1_990);

  const stale = baseInput();
  stale.quoteCut.maxQuoteAgeMs = 5;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(stale),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const expired = baseInput();
  expired.quoteCut.spot.provenance.expiresAtMs = OBSERVED_AT_MS - 1;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(expired),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const future = baseInput();
  future.quoteCut.spot.provenance.receivedAtMs = OBSERVED_AT_MS + 1;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(future),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const crossed = baseInput();
  crossed.quoteCut.spot.askPrice = '99.97';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(crossed),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const falseSpotEventTime = baseInput();
  falseSpotEventTime.quoteCut.spot.provenance.sourceEventAtMs = 1_989;
  falseSpotEventTime.quoteCut.spot.provenance.timeBasis = 'EXCHANGE_EVENT_TIME';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(falseSpotEventTime),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const falselyObservedFee = baseInput();
  falselyObservedFee.costs.spotOpenFee.state = 'OBSERVED_PUBLIC';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(falselyObservedFee),
    { name: 'TypeError', message: 'public Basis cost component is invalid' },
  );

  const stalePerpetualSource = baseInput();
  stalePerpetualSource.quoteCut.perpetual.provenance.sourceTransactionAtMs =
    OBSERVED_AT_MS - stalePerpetualSource.quoteCut.maxQuoteAgeMs - 1;
  stalePerpetualSource.quoteCut.perpetual.provenance.sourceEventAtMs =
    stalePerpetualSource.quoteCut.perpetual.provenance.sourceTransactionAtMs;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(stalePerpetualSource),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const invertedPerpetualChronology = baseInput();
  invertedPerpetualChronology.quoteCut.perpetual.provenance.sourceTransactionAtMs =
    Number(invertedPerpetualChronology.quoteCut.perpetual.provenance.receivedAtMs) + 1;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(invertedPerpetualChronology),
    { name: 'TypeError', message: 'public Basis quote cut is invalid' },
  );

  const mislabeledSlippage = baseInput();
  mislabeledSlippage.costs.slippage.state = 'PUBLIC_SCHEDULE_ASSUMPTION';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(mislabeledSlippage),
    { name: 'TypeError', message: 'public Basis cost component is invalid' },
  );

  const mislabeledFundingCarry = baseInput();
  mislabeledFundingCarry.costs.fundingCarry.state = 'PUBLIC_SCHEDULE_ASSUMPTION';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(mislabeledFundingCarry),
    { name: 'TypeError', message: 'public Basis cost component is invalid' },
  );
});

test('stale or provenance-incomplete public quotes remain recorded with UNKNOWN economics', () => {
  const stale = baseInput();
  stale.quoteCut.spot.state = 'STALE';
  stale.quoteCut.spot.provenance.receivedAtMs =
    OBSERVED_AT_MS - stale.quoteCut.maxQuoteAgeMs - 1;
  const staleObservation = buildPublicBasisOpportunityObservation(stale);
  assert.equal(staleObservation.economics.grossExecutableEdgePct, null);
  assert.equal(staleObservation.economics.grossExecutableEdgeState, 'UNKNOWN');
  assert.equal(staleObservation.economics.configuredProxyNetEdgePct, null);
  assert.equal(staleObservation.economics.configuredProxyNetState, 'UNKNOWN');
  assert.ok(staleObservation.reasonCodes.includes('PUBLIC_GROSS_EDGE_UNKNOWN'));

  const incomplete = baseInput();
  incomplete.quoteCut.spot.state = 'UNKNOWN';
  incomplete.quoteCut.spot.provenance = provenance({
    authority: 'UNKNOWN',
    sourceId: null,
    revision: null,
    timeBasis: 'UNKNOWN',
  });
  const incompleteObservation = buildPublicBasisOpportunityObservation(incomplete);
  assert.equal(incompleteObservation.economics.grossExecutableEdgePct, null);
  assert.equal(incompleteObservation.economics.grossExecutableEdgeState, 'UNKNOWN');
  assert.equal(incompleteObservation.economics.configuredProxyNetEdgePct, null);
  assert.equal(incompleteObservation.economics.accountEffectiveNetEdgePct, null);
  assert.deepEqual(validatePublicBasisOpportunityObservation(incompleteObservation), []);
});

test('strict validation and decoding reject shape, content, digest, and identity tampering', () => {
  const observation = buildPublicBasisOpportunityObservation(baseInput());
  const cases = [
    {
      expected: ['OBSERVATION_SHAPE_INVALID'],
      mutate(value) {
        value.unexpected = true;
      },
    },
    {
      expected: ['OBSERVATION_CONTENT_OR_IDENTITY_INVALID'],
      mutate(value) {
        value.schema = 'cosmos.engine.basis.public-opportunity-observation-forged';
      },
    },
    {
      expected: ['OBSERVATION_CONTENT_OR_IDENTITY_INVALID'],
      mutate(value) {
        value.economics.configuredProxyNetEdgePct = '99';
      },
    },
    {
      expected: ['OBSERVATION_CONTENT_OR_IDENTITY_INVALID'],
      mutate(value) {
        value.contentDigestSha256 = '0'.repeat(64);
      },
    },
    {
      expected: ['OBSERVATION_CONTENT_OR_IDENTITY_INVALID'],
      mutate(value) {
        value.observationId = `basisobs_${'0'.repeat(32)}`;
      },
    },
  ];

  for (const fixture of cases) {
    const tampered = clone(observation);
    fixture.mutate(tampered);
    assert.deepEqual(validatePublicBasisOpportunityObservation(tampered), fixture.expected);
    assert.equal(isPublicBasisOpportunityObservation(tampered), false);
    assert.equal(decodePublicBasisOpportunityObservation(tampered), null);
  }
});

test('hostile getters, toJSON hooks, Proxies, and cycles are rejected without invocation', () => {
  const validObservation = buildPublicBasisOpportunityObservation(baseInput());

  let getterReads = 0;
  const accessorInput = baseInput();
  Object.defineProperty(accessorInput, 'symbol', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'TESTUSDT';
    },
  });
  assert.throws(
    () => buildPublicBasisOpportunityObservation(accessorInput),
    { name: 'TypeError', message: 'public Basis opportunity input must be passive plain data' },
  );
  assert.equal(getterReads, 0);

  let toJsonCalls = 0;
  const toJsonInput = baseInput();
  toJsonInput.toJSON = () => {
    toJsonCalls += 1;
    return {};
  };
  assert.throws(
    () => buildPublicBasisOpportunityObservation(toJsonInput),
    { name: 'TypeError', message: 'public Basis opportunity input must be passive plain data' },
  );
  assert.equal(toJsonCalls, 0);

  let proxyTraps = 0;
  const proxyInput = new Proxy(baseInput(), {
    getPrototypeOf(target) {
      proxyTraps += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      proxyTraps += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(
    () => buildPublicBasisOpportunityObservation(proxyInput),
    { name: 'TypeError', message: 'public Basis opportunity input must be passive plain data' },
  );
  assert.equal(proxyTraps, 0);

  const cyclicInput = baseInput();
  cyclicInput.quoteCut.cycle = cyclicInput;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(cyclicInput),
    { name: 'TypeError', message: 'public Basis opportunity input must be passive plain data' },
  );

  let validationGetterReads = 0;
  const accessorObservation = clone(validObservation);
  Object.defineProperty(accessorObservation.economics, 'configuredProxyNetState', {
    enumerable: true,
    get() {
      validationGetterReads += 1;
      return 'ASSUMPTION_BOUND';
    },
  });
  assert.deepEqual(
    validatePublicBasisOpportunityObservation(accessorObservation),
    ['OBSERVATION_SHAPE_INVALID'],
  );
  assert.equal(isPublicBasisOpportunityObservation(accessorObservation), false);
  assert.equal(decodePublicBasisOpportunityObservation(accessorObservation), null);
  assert.equal(validationGetterReads, 0);

  let validationProxyTraps = 0;
  const proxyObservation = new Proxy(validObservation, {
    getPrototypeOf(target) {
      validationProxyTraps += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      validationProxyTraps += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(
    validatePublicBasisOpportunityObservation(proxyObservation),
    ['OBSERVATION_SHAPE_INVALID'],
  );
  assert.equal(isPublicBasisOpportunityObservation(proxyObservation), false);
  assert.equal(decodePublicBasisOpportunityObservation(proxyObservation), null);
  assert.equal(validationProxyTraps, 0);
});

test('invalid envelopes and payloads beyond the binary bound fail closed', () => {
  const invalidTime = baseInput();
  invalidTime.observedAtMs = OPPORTUNITY_CREATED_AT_MS - 1;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(invalidTime),
    { name: 'TypeError', message: 'public Basis opportunity identity or time envelope is invalid' },
  );

  const nonCanonicalOwnerEdge = baseInput();
  nonCanonicalOwnerEdge.ownerReportedNetEdgePct = '1.820';
  assert.throws(
    () => buildPublicBasisOpportunityObservation(nonCanonicalOwnerEdge),
    { name: 'TypeError', message: 'owner-reported Basis edge is not a canonical decimal' },
  );

  const overbound = baseInput();
  const longReasons = Array.from(
    { length: 16 },
    (_, index) => `R${String(index).padStart(2, '0')}_${'X'.repeat(92)}`,
  );
  overbound.quoteCut.spot.reasonCodes = longReasons;
  overbound.quoteCut.perpetual.reasonCodes = longReasons;
  for (const cost of Object.values(overbound.costs)) cost.reasonCodes = longReasons;
  assert.throws(
    () => buildPublicBasisOpportunityObservation(overbound),
    { name: 'RangeError', message: 'public Basis opportunity input exceeds its payload bound' },
  );
});
