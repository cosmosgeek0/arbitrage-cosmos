import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA,
  L081_BINANCE_SPOT_API_GIT_COMMIT,
  L081_BINANCE_SPOT_ENUMS_SHA256,
  L081_BINANCE_SPOT_REST_API_SHA256,
  bindSpotOrderTifCapability,
  currentSpotOrderTifDocumentaryRevision,
  deriveFilterReferenceEvidenceRevision,
  deriveSpotOrderTifCapabilityRevision,
  preflightInstrumentSizing,
  validateSpotOrderTifCapability,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  L081_T0,
  makeSpotOrderTifCapability,
  makeSpotRegistry,
  makeSpotSizingRequest,
} from '../fixtures/spotOrderTif.mjs';

function assertFrozenGraph(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertFrozenGraph(child, seen);
}

test('accepted L04 static preflight remains fail-closed while the exact Spot bridge passes', () => {
  const registry = makeSpotRegistry();
  const request = makeSpotSizingRequest(registry);
  const legacy = preflightInstrumentSizing(registry, request);
  assert.equal(legacy.staticState, 'BLOCKED');
  assert.deepEqual(legacy.reasonCodes, ['TIME_IN_FORCE_NOT_ADVERTISED']);

  const result = bindSpotOrderTifCapability(registry, request);
  assert.equal(result.ok, true);
  assert.equal(result.binding.state, 'PASS');
  assert.equal(result.binding.schema, BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA);
  assert.equal(result.binding.orderType, 'LIMIT');
  assert.equal(result.binding.timeInForce, 'GTC');
  assert.equal(result.binding.instrumentRevision, registry.instruments[0].instrumentRevision);
  assert.equal(result.binding.sourceEvidenceRevision, registry.instruments[0].sourceEvidenceRevision);
  assert.equal(result.binding.registryRevision, registry.registryRevision);
  assert.equal(result.binding.snapshotRevision, registry.snapshotRevision);
  assert.equal(result.binding.sendEligible, false);
  assert.equal(result.binding.externalActionAuthorization, 'NONE');
  assert.equal(result.binding.actionAuthority, 'NONE_RECORD_ONLY');
  assert.deepEqual(result.binding.resolvedCapabilityGaps, ['SPOT_TIME_IN_FORCE_UNAVAILABLE']);
  assert.ok(result.binding.remainingExternalRequirements.includes('SPOT_EXECUTION_RULES_UNAVAILABLE'));
  assert.ok(!result.binding.remainingExternalRequirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));
  assertFrozenGraph(result);
});

test('the bridge accepts only the current documentary LIMIT TIF set', () => {
  for (const timeInForce of ['FOK', 'GTC', 'IOC']) {
    const { capability } = makeSpotOrderTifCapability({ request: { timeInForce } });
    assert.equal(capability.timeInForce, timeInForce);
    assert.equal(capability.spotApiGitCommit, L081_BINANCE_SPOT_API_GIT_COMMIT);
    assert.equal(capability.restApiSha256, L081_BINANCE_SPOT_REST_API_SHA256);
    assert.equal(capability.enumsSha256, L081_BINANCE_SPOT_ENUMS_SHA256);
    assert.equal(capability.documentaryRevision, currentSpotOrderTifDocumentaryRevision());
    assert.equal(validateSpotOrderTifCapability(capability).capabilityRevision,
      capability.capabilityRevision);
  }

  const registry = makeSpotRegistry();
  for (const request of [
    makeSpotSizingRequest(registry, { orderType: 'MARKET', timeInForce: null, requestedPrice: null }),
    makeSpotSizingRequest(registry, { timeInForce: 'GTD' }),
    makeSpotSizingRequest(registry, { timeInForce: null }),
  ]) {
    assert.equal(bindSpotOrderTifCapability(registry, request).ok, false);
  }
});

test('capability content, Runtime revisions and validity are exact fail-closed bindings', () => {
  const { registry, request, capability } = makeSpotOrderTifCapability();
  const tampered = structuredClone(capability);
  tampered.requestedQuantity = '0.2';
  assert.throws(() => validateSpotOrderTifCapability(tampered), /content-addressed/u);

  const forgedDocumentary = structuredClone(capability);
  forgedDocumentary.restApiSha256 = '0'.repeat(64);
  const { capabilityRevision: _revision, ...material } = forgedDocumentary;
  forgedDocumentary.capabilityRevision = deriveSpotOrderTifCapabilityRevision(material);
  assert.throws(() => validateSpotOrderTifCapability(forgedDocumentary), /documentary revision/u);

  const forgedArithmetic = structuredClone(capability);
  forgedArithmetic.resultNotional = '9';
  const { capabilityRevision: _arithmeticRevision, ...arithmeticMaterial } = forgedArithmetic;
  forgedArithmetic.capabilityRevision = deriveSpotOrderTifCapabilityRevision(arithmeticMaterial);
  assert.throws(() => validateSpotOrderTifCapability(forgedArithmetic), /sizing projection/u);

  const forgedCanary = structuredClone(capability);
  forgedCanary.requestedQuantity = '0.5';
  forgedCanary.resultQuantity = '0.5';
  forgedCanary.resultNotional = '50';
  const { capabilityRevision: _canaryRevision, ...canaryMaterial } = forgedCanary;
  forgedCanary.capabilityRevision = deriveSpotOrderTifCapabilityRevision(canaryMaterial);
  assert.throws(() => validateSpotOrderTifCapability(forgedCanary), /sizing projection/u);

  for (const hiddenLoss of [
    'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
    'MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE',
    'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
  ]) {
    const lossElision = structuredClone(capability);
    lossElision.remainingExternalRequirements = lossElision.remainingExternalRequirements
      .filter((requirement) => requirement !== hiddenLoss);
    const { capabilityRevision: _lossRevision, ...lossMaterial } = lossElision;
    lossElision.capabilityRevision = deriveSpotOrderTifCapabilityRevision(lossMaterial);
    assert.throws(() => validateSpotOrderTifCapability(lossElision), /hide a product-specific loss/u);
  }

  const changedRegistry = makeSpotRegistry({ maximumAgeMs: 121_000 });
  const oldRequestAgainstChangedRuntime = {
    ...request,
    evaluatedAtMs: L081_T0,
  };
  const changed = bindSpotOrderTifCapability(changedRegistry, oldRequestAgainstChangedRuntime);
  assert.deepEqual(changed, {
    ok: false,
    reasonCodes: ['SPOT_CAPABILITY_INSTRUMENT_UNAVAILABLE'],
  });

  const expired = bindSpotOrderTifCapability(registry, {
    ...request,
    evaluatedAtMs: capability.validUntilMs + 1,
  });
  assert.equal(expired.ok, false);
  assert.ok(expired.reasonCodes.includes('SOURCE_STALE')
    || expired.reasonCodes.includes('SPOT_CAPABILITY_SOURCE_EXPIRED'));
});

test('direct capability validation rejects nested hostile graphs without invoking caller code', () => {
  const { capability } = makeSpotOrderTifCapability();
  let proxyTraps = 0;
  const proxied = structuredClone(capability);
  proxied.reasonCodes = new Proxy([], {
    get() {
      proxyTraps += 1;
      throw new Error('must not run');
    },
  });
  assert.throws(() => validateSpotOrderTifCapability(proxied), /plain data/u);
  assert.equal(proxyTraps, 0);

  let getters = 0;
  const accessor = structuredClone(capability);
  const requirements = [...accessor.remainingExternalRequirements];
  Object.defineProperty(requirements, '0', {
    enumerable: true,
    configurable: true,
    get() {
      getters += 1;
      throw new Error('must not run');
    },
  });
  accessor.remainingExternalRequirements = requirements;
  assert.throws(() => validateSpotOrderTifCapability(accessor), /data elements/u);
  assert.equal(getters, 0);
});

test('one exact owner cut is deterministic and does not widen the accepted registry', () => {
  const first = makeSpotOrderTifCapability();
  const second = makeSpotOrderTifCapability();
  assert.deepEqual(second, first);
  assert.deepEqual(first.registry.instruments[0].allowedTimeInForce, []);
  assert.ok(first.registry.instruments[0].lossCodes.includes('SPOT_EXECUTION_RULES_UNAVAILABLE'));
  assert.ok(first.registry.instruments[0].lossCodes.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE'));
});

test('dynamic Spot price evidence bounds the bridge and expires without becoming zero', () => {
  const registry = makeSpotRegistry({
    filters: [
      { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
      { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
      { filterType: 'MIN_NOTIONAL', minNotional: '0.1', applyToMarket: true, avgPriceMins: 5 },
      { filterType: 'PERCENT_PRICE', multiplierUp: '1.2', multiplierDown: '0.8', avgPriceMins: 5 },
    ],
  });
  const instrument = registry.instruments[0];
  const referenceMaterial = {
    schema: 'BINANCE_FILTER_REFERENCE_EVIDENCE_V1',
    producer: 'INTELLIGENCE_RUNTIME',
    product: 'SPOT',
    symbol: instrument.symbol,
    instrumentRevision: instrument.instrumentRevision,
    kind: 'WEIGHTED_AVERAGE',
    averagingWindowMins: 5,
    price: '100',
    observedAtMs: L081_T0 - 100,
    validUntilMs: L081_T0 + 1_000,
    sourceTruthId: 'runtime-filter-reference:l081-test',
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
  };
  const referencePrice = {
    ...referenceMaterial,
    evidenceRevision: deriveFilterReferenceEvidenceRevision(referenceMaterial),
  };
  const request = makeSpotSizingRequest(registry, { referencePrice });
  const bound = bindSpotOrderTifCapability(registry, request);
  assert.equal(bound.ok, true, bound.reasonCodes?.join(','));
  assert.equal(bound.binding.referenceEvidenceRevision, referencePrice.evidenceRevision);
  assert.equal(bound.binding.validUntilMs, referencePrice.validUntilMs);

  const stale = bindSpotOrderTifCapability(registry, {
    ...request,
    evaluatedAtMs: referencePrice.validUntilMs + 1,
  });
  assert.equal(stale.ok, false);
  assert.ok(stale.reasonCodes.includes('FILTER_REFERENCE_EVIDENCE_REJECTED'));
});
