import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  canonicalJson,
  deriveCorrelationId,
} from '../../../dist/foundation/contracts/index.js';
import { createRateBudgetState } from '../../../dist/liveEdge/adapters/binanceSignedKernel/index.js';
import {
  exchangeTwinOwnerEvidenceSha256,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  evaluateExchangeTwinInstrumentPreflight,
  evaluateExchangeTwinRateReservation,
  bindExchangeTwinRequestSemanticEvidence,
  validateExchangeTwinRequestSemanticEvidence,
} from '../../../dist/liveEdge/adapters/exchangeTwin/ownerEvidence.js';
import {
  T0,
  baselineEvents,
  event,
  orderFixture,
  scenarioInput,
} from './fixtures.mjs';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';

function requestClockSamples(product) {
  return [0, 1, 2].map((index) => {
    const monotonicSendMs = 1_000 + (index * 3_000);
    const monotonicReceiveMs = monotonicSendMs + 100;
    return {
      product,
      environment: 'PRODUCTION',
      utcSendEpochMs: 1_700_000_000_000 + monotonicSendMs,
      utcReceiveEpochMs: 1_700_000_000_000 + monotonicReceiveMs,
      monotonicSendMs,
      monotonicReceiveMs,
      serverEpochMs: 1_700_000_000_000 + monotonicSendMs + 75,
    };
  });
}

function usdmRequestInput(fixture, overrides = {}) {
  const identity = fixture?.l06Snapshot.identity ?? {};
  const parameters = overrides.parameters ?? [
    ['symbol', fixture?.symbol ?? 'BTCUSDT'],
    ['side', overrides.side ?? fixture?.side ?? 'BUY'],
    ['type', 'LIMIT'],
    ['timeInForce', 'GTC'],
    ['quantity', fixture?.quantity ?? '0.1'],
    ['price', fixture?.price ?? '60000'],
    ['positionSide', 'BOTH'],
    ['reduceOnly', 'false'],
  ];
  return {
    contractId: 'USDM_ORDER_POST',
    expectedProduct: 'USD_M_PERPETUAL',
    expectedEnvironment: 'PRODUCTION',
    parameters,
    clockSamples: requestClockSamples('USD_M_PERPETUAL'),
    nowMonotonicMs: 7_100,
    correlationId: overrides.correlationId ?? identity.globalCorrelationId ?? deriveCorrelationId({
      origin: 'liveEdge.exchangeTwin.test',
      key: 'request-semantics-helper-0001',
    }),
    requestSequence: overrides.requestSequence ?? 1,
    clientOrderIdentity: overrides.clientOrderIdentity ?? {
      planId: identity.ticketId ?? 'plan_l07_request_semantics_helper',
      legId: identity.legId ?? 'leg_l07_request_semantics_helper',
      attempt: identity.attempt ?? 0,
    },
  };
}

function requestBoundFixture(fixture, requestInput) {
  const bound = bindExchangeTwinRequestSemanticEvidence(requestInput);
  assert.equal(bound.ok, true, JSON.stringify(bound));
  const evidence = bound.evidence;
  const identity = fixture.l06Snapshot.identity;
  const resultNotional = '3.03';
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: requestInput.correlationId,
      ticketId: requestInput.clientOrderIdentity.planId,
      legId: requestInput.clientOrderIdentity.legId,
      attempt: requestInput.clientOrderIdentity.attempt,
      requestId: evidence.requestId,
      requestSequence: evidence.requestSequence,
      intentFingerprint: evidence.intentFingerprint,
      clientOrderId: evidence.clientOrderId,
      product: fixture.product,
      accountRealmId: identity.accountRealmId,
      symbol: fixture.symbol,
      mutationKind: 'PLACE_ORDER',
      contractId: evidence.contractId,
      contractState: 'CURRENT',
      signerProfile: identity.signerProfile,
    },
    requestedQuantity: fixture.quantity,
    preflightResult: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      requestedPrice: fixture.price,
      validationPrice: fixture.price,
      requestedQuantity: fixture.quantity,
      resultQuantity: fixture.quantity,
      resultNotional,
      effectiveNotionalCeiling: '10',
      canaryMaximumNotional: '10',
    },
    bindings: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      preflightResultQuantity: fixture.quantity,
      preflightResultNotional: resultNotional,
      preflightCanaryMaximumNotional: '10',
      sanitizedRequestContentHash: evidence.sanitizedRequestContentHash,
    },
  });
  const persisted = submittingPersisted(input);
  return {
    evidence,
    fixture: {
      ...fixture,
      l06Snapshot: persisted.snapshot,
      l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
    },
  };
}

test('owner evidence digest is deterministic and content-sensitive', () => {
  const evidence = { schema: 'OWNER_EVIDENCE_TEST_V1', revision: 'owner-revision-0001', value: '1' };
  const first = exchangeTwinOwnerEvidenceSha256(evidence);
  const second = exchangeTwinOwnerEvidenceSha256({ ...evidence });
  const changed = exchangeTwinOwnerEvidenceSha256({ ...evidence, value: '2' });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
  assert.notEqual(changed, first);
});

test('L04 wrapper preserves canonical hostile-input rejection without fabricating a pass', () => {
  const result = evaluateExchangeTwinInstrumentPreflight({}, {}, 1);
  assert.notEqual(result.staticState, 'PASS');
  assert.ok(result.reasonCodes.includes('STATIC_PREFLIGHT_INPUT_REJECTED'));
  assert.equal(result.sendEligible, false);
  assert.equal(result.externalActionAuthorization, 'NONE');
});

test('L03 wrapper returns the canonical owner decision and binds injected time exactly', () => {
  const atMs = 1_000;
  const input = {
    contractId: 'SPOT_OPEN_ORDERS_QUERY',
    product: 'SPOT',
    environment: 'PRODUCTION',
    scopeHandles: { IP: 'egress:prod-a', ACCOUNT: 'account:execution-a' },
    capacities: [{
      product: 'SPOT',
      environment: 'PRODUCTION',
      scopeKind: 'IP',
      scopeHandle: 'egress:prod-a',
      rateKind: 'REQUEST_WEIGHT',
      interval: 'MINUTE',
      capacity: 200,
      windowStartedAtMs: 0,
      windowEndsAtMs: 60_000,
    }],
    atMs,
  };
  const state = createRateBudgetState();
  const decision = evaluateExchangeTwinRateReservation(state, input, atMs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'USAGE_UNKNOWN');
  assert.strictEqual(decision.state, state);
  assert.throws(
    () => evaluateExchangeTwinRateReservation(state, input, atMs + 1),
    /must equal the supplied twin time/,
  );
});

test('L03 request-semantic binding retains no query and preserves one-way order fields', () => {
  const input = {
    contractId: 'USDM_ORDER_POST',
    expectedProduct: 'USD_M_PERPETUAL',
    expectedEnvironment: 'PRODUCTION',
    parameters: [
      ['symbol', 'BTCUSDT'],
      ['side', 'BUY'],
      ['type', 'LIMIT'],
      ['timeInForce', 'GTC'],
      ['quantity', '0.1'],
      ['price', '60000'],
      ['positionSide', 'BOTH'],
      ['reduceOnly', 'true'],
    ],
    clockSamples: requestClockSamples('USD_M_PERPETUAL'),
    nowMonotonicMs: 7_100,
    correlationId: deriveCorrelationId({
      origin: 'liveEdge.exchangeTwin.test',
      key: 'request-semantics-0001',
    }),
    requestSequence: 4,
    clientOrderIdentity: {
      planId: 'plan_l07_request_semantics_0001',
      legId: 'leg_l07_usdm_close_0001',
      attempt: 0,
    },
  };
  const result = bindExchangeTwinRequestSemanticEvidence(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  const evidence = validateExchangeTwinRequestSemanticEvidence(result.evidence);
  assert.equal(evidence.positionSide, 'BOTH');
  assert.equal(evidence.reduceOnly, true);
  assert.equal(evidence.quantity, '0.1');
  assert.match(evidence.sanitizedRequestContentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(evidence).includes('timestamp='), false);
  assert.equal(JSON.stringify(evidence).includes('recvWindow='), false);
  assert.equal(Object.hasOwn(evidence, 'query'), false);

  const falseInput = structuredClone(input);
  falseInput.parameters = falseInput.parameters.map(([name, value]) => (
    name === 'reduceOnly' ? [name, 'false'] : [name, value]
  ));
  const falseResult = bindExchangeTwinRequestSemanticEvidence(falseInput);
  assert.equal(falseResult.ok, true, JSON.stringify(falseResult));
  const forged = structuredClone(falseResult.evidence);
  forged.reduceOnly = true;
  const {
    schema: _forgedSchema,
    evidenceRevision: _forgedRevision,
    ...forgedMaterial
  } = forged;
  forged.evidenceRevision = `l07request_${createHash('sha256')
    .update(canonicalJson(forgedMaterial)).digest('hex')}`;
  assert.throws(
    () => validateExchangeTwinRequestSemanticEvidence(forged),
    /request semantic evidence is not canonical/,
  );

  const missingSemantics = structuredClone(input);
  missingSemantics.parameters = missingSemantics.parameters.filter(([name]) => (
    name !== 'positionSide'
  ));
  const rejected = bindExchangeTwinRequestSemanticEvidence(missingSemantics);
  assert.equal(rejected.ok, false);
  assert.match(rejected.code, /REQUEST_(?:SEMANTICS_NOT_CANONICAL|SEMANTIC_PROJECTION_FAILED)/);
});

test('request-semantic binding snapshots hostile input safely and closes placement vocabulary', () => {
  const fixture = orderFixture({ fixtureId: 'fixture-request-owner-hostility-0001' });
  const input = usdmRequestInput(fixture);
  let getterCalls = 0;
  const accessorInput = { ...input };
  Object.defineProperty(accessorInput, 'parameters', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return input.parameters;
    },
  });
  assert.deepEqual(bindExchangeTwinRequestSemanticEvidence(accessorInput), {
    ok: false,
    code: 'REQUEST_OWNER_INPUT_NOT_DATA',
  });
  assert.equal(getterCalls, 0);

  const proxyInput = new Proxy(input, {
    get() {
      getterCalls += 1;
      throw new Error('proxy trap must not run');
    },
  });
  assert.deepEqual(bindExchangeTwinRequestSemanticEvidence(proxyInput), {
    ok: false,
    code: 'REQUEST_OWNER_INPUT_NOT_DATA',
  });
  assert.equal(getterCalls, 0);

  const overbound = structuredClone(input);
  overbound.parameters = Array.from({ length: 513 }, (_, index) => [`p${index}`, 'x']);
  assert.deepEqual(bindExchangeTwinRequestSemanticEvidence(overbound), {
    ok: false,
    code: 'REQUEST_OWNER_INPUT_NOT_DATA',
  });

  for (const clientOrderIdentity of [
    { ...input.clientOrderIdentity, planId: 'apiKey=REDACTED' },
    { ...input.clientOrderIdentity, legId: 'Bearer REDACTED' },
    { ...input.clientOrderIdentity, planId: 'BINANCE_API_SECRET=REDACTED' },
    { ...input.clientOrderIdentity, legId: 'client_secret=REDACTED' },
    { ...input.clientOrderIdentity, legId: 'A'.repeat(64) },
  ]) {
    assert.deepEqual(
      bindExchangeTwinRequestSemanticEvidence({ ...input, clientOrderIdentity }),
      { ok: false, code: 'REQUEST_OWNER_INPUT_NOT_DATA' },
    );
  }

  for (const parameters of [
    input.parameters.map(([name, value]) => name === 'symbol' ? [name, 'bad symbol'] : [name, value]),
    input.parameters.map(([name, value]) => name === 'side' ? [name, 'HOLD'] : [name, value]),
    input.parameters.map(([name, value]) => name === 'quantity' ? [name, 'banana'] : [name, value]),
    input.parameters.map(([name, value]) => name === 'price' ? [name, '0'] : [name, value]),
    [...input.parameters, ['closePosition', 'true']],
  ]) {
    const result = bindExchangeTwinRequestSemanticEvidence({ ...input, parameters });
    assert.equal(result.ok, false, JSON.stringify(result));
  }
});

test('a canonical alternate request projection cannot bind a different L06 placement fixture', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-request-semantic-cross-binding-0001',
    product: 'USD_M_PERPETUAL',
    side: 'BUY',
    quantity: '0.03',
    price: '101',
  });
  const alternate = requestBoundFixture(fixture, usdmRequestInput(fixture, { side: 'SELL' }));
  validateExchangeTwinRequestSemanticEvidence(alternate.evidence);
  const events = baselineEvents(alternate.fixture).map((candidate) => (
    candidate.kind !== 'PLACE_DISPATCH'
      ? candidate
      : event(
        'PLACE_DISPATCH',
        candidate.sequence,
        candidate.occurredAtMs,
        { fixtureId: alternate.fixture.fixtureId, requestEvidence: alternate.evidence },
        { sourceSequence: candidate.sourceSequence },
      )
  ));
  assert.throws(
    () => runExchangeTwinScenario(scenarioInput({ fixture: alternate.fixture, events })),
    /placement request semantics do not bind L06\/fixture owner truth/,
  );
});

test('scenario snapshot rejects a nested request-parameter getter without executing it', () => {
  const fixture = orderFixture({
    fixtureId: 'fixture-request-semantic-getter-0001',
    product: 'USD_M_PERPETUAL',
    side: 'BUY',
    quantity: '0.03',
    price: '101',
  });
  const bound = requestBoundFixture(fixture, usdmRequestInput(fixture));
  const events = baselineEvents(bound.fixture).map((candidate) => (
    candidate.kind !== 'PLACE_DISPATCH'
      ? candidate
      : event(
        'PLACE_DISPATCH',
        candidate.sequence,
        candidate.occurredAtMs,
        { fixtureId: bound.fixture.fixtureId, requestEvidence: bound.evidence },
        { sourceSequence: candidate.sourceSequence },
      )
  ));
  const hostileScenario = structuredClone(scenarioInput({ fixture: bound.fixture, events }));
  const dispatch = hostileScenario.events.find((candidate) => candidate.kind === 'PLACE_DISPATCH');
  const original = dispatch.payload.requestEvidence.requestOwnerInput.parameters;
  const hostileParameters = new Array(original.length);
  let getterCalls = 0;
  Object.defineProperty(hostileParameters, '0', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('nested request-parameter getter must not execute');
    },
  });
  for (let index = 1; index < original.length; index += 1) {
    Object.defineProperty(hostileParameters, String(index), {
      value: original[index],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  dispatch.payload.requestEvidence.requestOwnerInput.parameters = hostileParameters;

  assert.throws(
    () => runExchangeTwinScenario(hostileScenario),
    /exchange-twin array must contain enumerable data/,
  );
  assert.equal(getterCalls, 0);
});
