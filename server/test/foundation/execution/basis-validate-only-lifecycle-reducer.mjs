#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindBasisValidateOnlyPlan,
} from '../../../dist/foundation/execution/basisValidateOnly/planBinding.js';
import {
  applyBasisValidateOnlyObservation,
  createBasisValidateOnlyLifecycle,
  isBasisValidateOnlyLifecycleState,
  replayBasisValidateOnlyLifecycle,
  restoreBasisValidateOnlyCheckpoint,
  serializeBasisValidateOnlyCheckpoint,
} from '../../../dist/foundation/execution/basisValidateOnly/lifecycle.js';
import {
  normalizeBinanceSpotInjectedQueryEvidence,
  prepareBinanceSpotValidateOnlyOrder,
} from '../../../dist/foundation/exchange/binanceSpotValidateOnlyAdapter/index.js';
import {
  verifyBasisFlatness,
} from '../../../dist/foundation/reconciliation/basisFlatness.js';
import {
  canonicalJson,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/identity.js';
import {
  makeWorld,
  enabledControls,
  NOW,
} from './basis-validate-only-plan-binding.mjs';
import {
  T0 as USDM_NOW,
  enabledAdapter,
  foundEvidence,
  fundingForecast,
  intentInput,
  positionModeEvidence,
  publicEvidence,
} from '../exchange/binanceUsdMAdapter/binance-usdm-basis-adapter.mjs';

const adapterInvocations = new WeakMap();
const queryInvocations = new WeakMap();

function deepFreeze(value, seen = new Set()) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function bindingFixture(overrides = {}) {
  const world = makeWorld({
    spotQuantity: 0.3,
    perpQuantity: 0.3,
    requestedCapital: '100',
    acceptedNotionalUsd: 100,
    allocationCap: '80',
    ...overrides,
  });
  const result = bindBasisValidateOnlyPlan(
    world.input,
    enabledControls(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return { world, binding: result.binding };
}

function spotStamp(sourceId, evaluatedAtMs = NOW) {
  return Object.freeze({
    sourceTimeMs: evaluatedAtMs - 10,
    receivedAtMs: evaluatedAtMs - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

function spotSnapshot(evaluatedAtMs = NOW) {
  const observedAt = spotStamp(
    'binance.spot.public.m1-i1',
    evaluatedAtMs,
  );
  return Object.freeze({
    snapshotId: 'spot-public-m1-i1',
    symbol: 'BTCUSDT',
    tradingStatus: 'TRADING',
    completeness: 'COMPLETE_SUPPORTED_FILTER_SET',
    filterObservedAt: observedAt,
    venueEvidenceObservedAt: observedAt,
    filters: Object.freeze([
      Object.freeze({
        filterType: 'PRICE_FILTER',
        minPrice: '1',
        maxPrice: '1000000',
        tickSize: '0.1',
      }),
      Object.freeze({
        filterType: 'LOT_SIZE',
        minQty: '0.001',
        maxQty: '100',
        stepSize: '0.001',
      }),
      Object.freeze({
        filterType: 'MARKET_LOT_SIZE',
        minQty: '0.001',
        maxQty: '50',
        stepSize: '0.001',
      }),
      Object.freeze({
        filterType: 'MIN_NOTIONAL',
        minNotional: '5',
        applyToMarket: true,
        avgPriceMins: 0,
      }),
    ]),
    venueEvidence: Object.freeze({
      referencePrice: Object.freeze({
        state: 'SET',
        price: '30',
        providerTimestampMs: evaluatedAtMs,
      }),
      fallbackPrices: Object.freeze([]),
      executionRules: Object.freeze([]),
    }),
  });
}

function expectedClientOrderId(binding, step, attempt) {
  const normal = binding.plan.normalBasisBinding;
  assert.ok(normal);
  if (step === 'SPOT_OPEN' || step === 'PERP_OPEN') {
    assert.equal(attempt, 0);
    return normal.steps[step].clientOrderId;
  }
  return normal.closeAttempts.find(
    (candidate) =>
      candidate.step === step && candidate.attempt === attempt,
  ).clientOrderId;
}

function expectedLegId(binding, step) {
  if (step === 'SPOT_OPEN') return binding.plan.openingLegs.SPOT.legId;
  if (step === 'SPOT_CLOSE') return binding.plan.closingLegs.SPOT.legId;
  if (step === 'PERP_OPEN') return binding.plan.openingLegs.PERP.legId;
  return binding.plan.closingLegs.PERP.legId;
}

function prepareSpot(
  binding,
  step,
  attempt,
  quantity,
  evaluatedAtMs = NOW,
) {
  const normal = binding.plan.normalBasisBinding;
  const input = deepFreeze({
    evaluatedAtMs,
    publicSnapshot: spotSnapshot(evaluatedAtMs),
    order: Object.freeze({
      planId: binding.plan.planId,
      legId: expectedLegId(binding, step),
      attempt,
      symbol: binding.symbol,
      clientOrderId: expectedClientOrderId(binding, step, attempt),
      side: normal.steps[step].side,
      type: 'LIMIT',
      quantity,
      price: binding.spotPriceExact,
      timeInForce: 'GTC',
    }),
    policy: Object.freeze({
      enabled: true,
      killSwitchEngaged: false,
      authority: 'NONE',
    }),
  });
  const result = prepareBinanceSpotValidateOnlyOrder(input);
  assert.equal(result.status, 'VALIDATED', JSON.stringify(result));
  adapterInvocations.set(result, deepFreeze({
    adapter: 'BINANCE_SPOT',
    config: null,
    input,
  }));
  return result;
}

function prepareUsdM(
  binding,
  step,
  attempt,
  quantity,
  evaluatedAtMs = USDM_NOW,
) {
  const config = Object.freeze({
    enabled: true,
    sourceEnabled: true,
    killSwitchEngaged: false,
    authority: 'NONE',
    allowedSymbols: Object.freeze(['BTCUSDT']),
  });
  const adapter = enabledAdapter();
  const input = intentInput({
    nowMs: evaluatedAtMs,
    leg: step,
    existingClientOrderId:
      expectedClientOrderId(binding, step, attempt),
    type: 'LIMIT',
    quantity,
    price: binding.perpPriceExact,
    positionModeEvidence: positionModeEvidence({
      observedAtMs: evaluatedAtMs - 1,
      receivedAtMs: evaluatedAtMs,
    }),
    publicEvidence: publicEvidence({
      nowMs: evaluatedAtMs,
      fundingForecast: fundingForecast({
        nowMs: evaluatedAtMs,
        markPrice: '30',
      }),
    }),
  });
  const result = adapter.buildOrderIntent(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  adapterInvocations.set(result, deepFreeze({
    adapter: 'BINANCE_USDM',
    config,
    input,
  }));
  return { adapter, result };
}

function normalizeUsdMQuery(prepared, evidence) {
  const resolution = prepared.adapter.normalizeOrderQueryEvidence(
    prepared.result.intent,
    evidence,
  );
  const validationInvocation =
    adapterInvocations.get(prepared.result);
  queryInvocations.set(resolution, deepFreeze({
    adapter: 'BINANCE_USDM',
    config: validationInvocation.config,
    validationInput: validationInvocation.input,
    queryInput: evidence,
  }));
  return resolution;
}

function normalizeSpotQuery(preparation, input) {
  const resolution = normalizeBinanceSpotInjectedQueryEvidence(
    preparation,
    input,
  );
  const validationInvocation = adapterInvocations.get(preparation);
  queryInvocations.set(resolution, deepFreeze({
    adapter: 'BINANCE_SPOT',
    config: null,
    validationInput: validationInvocation.input,
    queryInput: input,
  }));
  return resolution;
}

function apply(state, binding, observation) {
  const result = applyBasisValidateOnlyObservation(
    binding,
    state,
    observation,
  );
  assert.equal(result.applied, true, JSON.stringify(result));
  return result.state;
}

function validate(state, binding, step, attempt, adapterResult) {
  return apply(state, binding, {
    kind: 'VALIDATION',
    step,
    attempt,
    adapterResult,
    adapterInvocation: adapterInvocations.get(adapterResult),
  });
}

function outcome(
  state,
  binding,
  step,
  attempt,
  phase,
  terminalStatus = null,
  quantity = null,
) {
  return apply(state, binding, {
    kind: 'OUTCOME',
    step,
    attempt,
    clientOrderId: expectedClientOrderId(binding, step, attempt),
    state: phase,
    terminalStatus,
    cumulativeFilledQuantityExact: quantity,
    evidenceAuthority: 'SYNTHETIC_TEST',
  });
}

function throughBothOpenLegs(binding) {
  let state = createBasisValidateOnlyLifecycle(binding);
  const spotOpen = prepareSpot(
    binding,
    'SPOT_OPEN',
    0,
    binding.spotQuantityExact,
  );
  state = validate(state, binding, 'SPOT_OPEN', 0, spotOpen);
  state = outcome(
    state,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    binding.spotQuantityExact,
  );
  const perpOpen = prepareUsdM(
    binding,
    'PERP_OPEN',
    0,
    state.expectedQuantityExact,
  );
  state = validate(state, binding, 'PERP_OPEN', 0, perpOpen.result);
  state = outcome(
    state,
    binding,
    'PERP_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    state.expectedQuantityExact,
  );
  return state;
}

function throughPerpClose(binding) {
  let state = throughBothOpenLegs(binding);
  const perpClose = prepareUsdM(
    binding,
    'PERP_CLOSE',
    0,
    state.expectedQuantityExact,
  );
  state = validate(
    state,
    binding,
    'PERP_CLOSE',
    0,
    perpClose.result,
  );
  state = outcome(
    state,
    binding,
    'PERP_CLOSE',
    0,
    'TERMINAL',
    'FILLED',
    state.expectedQuantityExact,
  );
  return state;
}

function flatnessInput(binding, state) {
  const normal = binding.plan.normalBasisBinding;
  const closeIds = (step) =>
    normal.closeAttempts
      .filter((candidate) => candidate.step === step)
      .sort((left, right) => left.attempt - right.attempt)
      .map((candidate) => candidate.clientOrderId);
  const identity = {
    planId: binding.plan.planId,
    bindingId: binding.bindingId,
    termsFingerprint: binding.plan.termsFingerprint,
    accountId: binding.accountId,
    symbol: binding.symbol,
    acceptedRevisionTs: binding.acceptedRevisionTs,
    stateRevision: state.revision,
    stateRevisionId: state.stateRevisionId,
    direction: 'LONG_SPOT_SHORT_PERP',
    positionMode: 'ONE_WAY',
    clientOrderIds: {
      SPOT_OPEN: normal.steps.SPOT_OPEN.clientOrderId,
      PERP_OPEN: normal.steps.PERP_OPEN.clientOrderId,
      PERP_CLOSE: normal.steps.PERP_CLOSE.clientOrderId,
      SPOT_CLOSE: normal.steps.SPOT_CLOSE.clientOrderId,
    },
    closeAttemptClientOrderIds: {
      PERP_CLOSE: closeIds('PERP_CLOSE'),
      SPOT_CLOSE: closeIds('SPOT_CLOSE'),
    },
    actionAuthority: 'NONE_RECORD_ONLY',
    riskAuthority: 'NONE',
    sendEligible: false,
  };
  const common = {
    planId: identity.planId,
    bindingId: identity.bindingId,
    termsFingerprint: identity.termsFingerprint,
    accountId: identity.accountId,
    symbol: identity.symbol,
    acceptedRevisionTs: identity.acceptedRevisionTs,
    stateRevision: identity.stateRevision,
    stateRevisionId: identity.stateRevisionId,
  };
  const order = (
    step,
    attempt,
    status,
    submittedQuantityExact,
    cumulativeFilledQuantityExact,
    terminalObservedAtMs,
  ) => ({
    step,
    attempt,
    ...common,
    venue:
      step.startsWith('SPOT') ? 'BINANCE_SPOT' : 'BINANCE_USDM',
    side: normal.steps[step].side,
    reduceOnly: normal.steps[step].reduceOnly,
    clientOrderId: expectedClientOrderId(binding, step, attempt),
    status,
    submittedQuantityExact,
    cumulativeFilledQuantityExact,
    ambiguous: false,
    terminalObservedAtMs,
  });
  const validations = new Map(
    state.journal
      .filter((entry) => entry.kind === 'VALIDATION')
      .map((entry) => [
        `${entry.step}:${entry.attempt}:${entry.clientOrderId}`,
        entry,
      ]),
  );
  const terminalOrders = state.journal
    .filter(
      (entry) =>
        (entry.kind === 'OUTCOME' || entry.kind === 'QUERY') &&
        entry.state === 'TERMINAL',
    )
    .map((entry, index) => {
      const validation = validations.get(
        `${entry.step}:${entry.attempt}:${entry.clientOrderId}`,
      );
      assert.ok(validation);
      return order(
        entry.step,
        entry.attempt,
        entry.terminalStatus,
        validation.quantityExact,
        entry.cumulativeFilledQuantityExact,
        NOW - 50 + (index * 10),
      );
    });
  const metadata = (sourceId, sourceTimeMs, receivedAtMs = sourceTimeMs) => ({
    sourceId,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs: 5_000,
  });
  const position = (venue, positionMode, baseline, current) => ({
    venue,
    accountId: identity.accountId,
    symbol: identity.symbol,
    acceptedRevisionTs: identity.acceptedRevisionTs,
    stateRevision: identity.stateRevision,
    stateRevisionId: identity.stateRevisionId,
    positionMode,
    baselineSignedBaseQuantityExact: baseline,
    currentSignedBaseQuantityExact: current,
    baselineMetadata: metadata(
      `${venue}.baseline.m1-i1`,
      binding.acceptedRevisionTs - 1,
      binding.acceptedRevisionTs,
    ),
    currentMetadata: metadata(`${venue}.current.m1-i1`, NOW - 1, NOW),
  });
  return deepFreeze({
    nowMs: NOW,
    policy: { maximumEvidenceAgeMs: 5_000 },
    plan: identity,
    evidence: {
      orders: {
        metadata: metadata('orders.m1-i1', NOW - 1, NOW),
        records: terminalOrders,
      },
      positions: [
        position('BINANCE_SPOT', 'CASH', '2', '2'),
        position('BINANCE_USDM', 'ONE_WAY', '-2', '-2'),
      ],
      ambiguities: [],
    },
  });
}

test('initial state is an inert validation record with no send authority', () => {
  const { binding } = bindingFixture();
  const state = createBasisValidateOnlyLifecycle(binding);
  assert.equal(isBasisValidateOnlyLifecycleState(state), true);
  assert.equal(state.next, 'SPOT_OPEN');
  assert.equal(state.attempt, 0);
  assert.equal(state.expectedQuantityExact, '0.3');
  assert.equal(state.action.disposition, 'VALIDATION_REQUIRED');
  assert.equal(state.action.sendEligible, false);
  assert.equal(state.action.sendAuthorized, false);
  assert.equal(state.executionAuthority, 'NONE');
  assert.equal(state.externalActionAuthorization, 'NONE');
  assert.equal(state.sendsPerformed, 0);
  assert.equal(state.networkRequestsPerformed, 0);
  assert.equal(state.ordersPerformed, 0);
  assert.throws(
    () => createBasisValidateOnlyLifecycle({ ...binding }),
    /nominal/,
  );
});

test('partial Spot fill preserves the immutable accepted hedge ratio exactly', () => {
  const { binding } = bindingFixture({
    spotQuantity: 1,
    perpQuantity: 1.005,
  });
  let state = createBasisValidateOnlyLifecycle(binding);
  state = validate(
    state,
    binding,
    'SPOT_OPEN',
    0,
    prepareSpot(binding, 'SPOT_OPEN', 0, '1'),
  );
  state = outcome(
    state,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'CANCELLED',
    '0.4',
  );
  assert.equal(state.next, 'PERP_OPEN');
  assert.equal(state.expectedQuantityExact, '0.402');
  assert.equal(state.action.clientOrderId, expectedClientOrderId(
    binding,
    'PERP_OPEN',
    0,
  ));
});

test('zero opening fills reconcile baseline or unwind known Spot exposure', () => {
  const { binding } = bindingFixture();
  let noExposure = createBasisValidateOnlyLifecycle(binding);
  noExposure = validate(
    noExposure,
    binding,
    'SPOT_OPEN',
    0,
    prepareSpot(binding, 'SPOT_OPEN', 0, '0.3'),
  );
  noExposure = outcome(
    noExposure,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'REJECTED',
    '0',
  );
  assert.equal(noExposure.next, 'FLATNESS');
  assert.equal(noExposure.action.disposition, 'FLATNESS_REQUIRED');
  const baselineInput = flatnessInput(binding, noExposure);
  const baselineFlat = verifyBasisFlatness(baselineInput);
  assert.equal(baselineFlat.status, 'FLAT', JSON.stringify(baselineFlat));
  noExposure = apply(noExposure, binding, {
    kind: 'FLATNESS',
    input: baselineInput,
    result: baselineFlat,
  });
  assert.equal(noExposure.complete, true);

  let spotExposure = createBasisValidateOnlyLifecycle(binding);
  spotExposure = validate(
    spotExposure,
    binding,
    'SPOT_OPEN',
    0,
    prepareSpot(binding, 'SPOT_OPEN', 0, '0.3'),
  );
  spotExposure = outcome(
    spotExposure,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const perpOpen = prepareUsdM(
    binding,
    'PERP_OPEN',
    0,
    spotExposure.expectedQuantityExact,
  );
  spotExposure = validate(
    spotExposure,
    binding,
    'PERP_OPEN',
    0,
    perpOpen.result,
  );
  spotExposure = outcome(
    spotExposure,
    binding,
    'PERP_OPEN',
    0,
    'TERMINAL',
    'REJECTED',
    '0',
  );
  assert.equal(spotExposure.next, 'SPOT_CLOSE');
  assert.equal(spotExposure.expectedQuantityExact, '0.3');
  spotExposure = validate(
    spotExposure,
    binding,
    'SPOT_CLOSE',
    0,
    prepareSpot(binding, 'SPOT_CLOSE', 0, '0.3'),
  );
  spotExposure = outcome(
    spotExposure,
    binding,
    'SPOT_CLOSE',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const unwindInput = flatnessInput(binding, spotExposure);
  const unwindFlat = verifyBasisFlatness(unwindInput);
  assert.equal(unwindFlat.status, 'FLAT', JSON.stringify(unwindFlat));
  spotExposure = apply(spotExposure, binding, {
    kind: 'FLATNESS',
    input: unwindInput,
    result: unwindFlat,
  });
  assert.equal(spotExposure.complete, true);
});

test('entry evidence is acceptance-window bound while closes remain available after expiry', () => {
  const { binding } = bindingFixture();
  const initial = createBasisValidateOnlyLifecycle(binding);
  for (const evaluatedAtMs of [
    binding.acceptedRevisionTs - 1,
    binding.proposalExpiresAtMs + 1,
  ]) {
    const preparation = prepareSpot(
      binding,
      'SPOT_OPEN',
      0,
      '0.3',
      evaluatedAtMs,
    );
    const refused = applyBasisValidateOnlyObservation(
      binding,
      initial,
      {
        kind: 'VALIDATION',
        step: 'SPOT_OPEN',
        attempt: 0,
        adapterResult: preparation,
        adapterInvocation: adapterInvocations.get(preparation),
      },
    );
    assert.equal(refused.applied, false);
    assert.equal(refused.code, 'OBSERVATION_INVALID');
    assert.equal(refused.state, initial);
  }

  const afterExpiry = binding.proposalExpiresAtMs + 100;
  let perpEntry = createBasisValidateOnlyLifecycle(binding);
  perpEntry = validate(
    perpEntry,
    binding,
    'SPOT_OPEN',
    0,
    prepareSpot(binding, 'SPOT_OPEN', 0, '0.3'),
  );
  perpEntry = outcome(
    perpEntry,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const expiredPerpOpen = prepareUsdM(
    binding,
    'PERP_OPEN',
    0,
    perpEntry.expectedQuantityExact,
    afterExpiry,
  );
  const expiredPerpRefused = applyBasisValidateOnlyObservation(
    binding,
    perpEntry,
    {
      kind: 'VALIDATION',
      step: 'PERP_OPEN',
      attempt: 0,
      adapterResult: expiredPerpOpen.result,
      adapterInvocation:
        adapterInvocations.get(expiredPerpOpen.result),
    },
  );
  assert.equal(expiredPerpRefused.applied, false);
  assert.equal(expiredPerpRefused.code, 'OBSERVATION_INVALID');

  let perpClosing = throughBothOpenLegs(binding);
  const afterExpiryPerpClose = prepareUsdM(
    binding,
    'PERP_CLOSE',
    0,
    perpClosing.expectedQuantityExact,
    afterExpiry,
  );
  perpClosing = validate(
    perpClosing,
    binding,
    'PERP_CLOSE',
    0,
    afterExpiryPerpClose.result,
  );
  assert.equal(
    perpClosing.action.disposition,
    'OUTCOME_RECORD_REQUIRED',
  );

  let closing = throughPerpClose(binding);
  const closePreparation = prepareSpot(
    binding,
    'SPOT_CLOSE',
    0,
    closing.expectedQuantityExact,
    afterExpiry,
  );
  closing = validate(
    closing,
    binding,
    'SPOT_CLOSE',
    0,
    closePreparation,
  );
  assert.equal(closing.action.disposition, 'OUTCOME_RECORD_REQUIRED');
});

test('same-ID nominal queries may repeat while working and resolve after entry expiry', () => {
  const { binding } = bindingFixture();
  let state = throughBothOpenLegs(binding);
  const close = prepareUsdM(
    binding,
    'PERP_CLOSE',
    0,
    state.expectedQuantityExact,
  );
  state = validate(state, binding, 'PERP_CLOSE', 0, close.result);
  state = outcome(state, binding, 'PERP_CLOSE', 0, 'AMBIGUOUS');
  const clientOrderId = state.activeClientOrderId;
  const queryDescriptorResult =
    close.adapter.buildOrderQueryDescriptor(close.result.intent);
  const workingEvidence = foundEvidence(close.result.intent, {
    order: { status: 'NEW', executedQty: '0' },
  });
  const working = normalizeUsdMQuery(
    close,
    workingEvidence,
  );
  for (let count = 0; count < 2; count += 1) {
    state = apply(state, binding, {
      kind: 'QUERY',
      step: 'PERP_CLOSE',
      attempt: 0,
      clientOrderId,
      adapterResult: close.result,
      queryDescriptorResult,
      queryResolution: working,
      queryInvocation: queryInvocations.get(working),
    });
    assert.equal(state.action.disposition, 'AWAIT_TERMINAL');
    assert.equal(state.activeClientOrderId, clientOrderId);
  }
  const afterExpiry = binding.proposalExpiresAtMs + 100;
  const terminalEvidence = foundEvidence(close.result.intent, {
    nowMs: afterExpiry,
    observedAtMs: afterExpiry - 1,
    receivedAtMs: afterExpiry,
    order: {
      status: 'FILLED',
      executedQty: state.expectedQuantityExact,
    },
  });
  const terminal = normalizeUsdMQuery(close, terminalEvidence);
  state = apply(state, binding, {
    kind: 'QUERY',
    step: 'PERP_CLOSE',
    attempt: 0,
    clientOrderId,
    adapterResult: close.result,
    queryDescriptorResult,
    queryResolution: terminal,
    queryInvocation: queryInvocations.get(terminal),
  });
  assert.equal(state.next, 'SPOT_CLOSE');
  const forgedQueryJournal = structuredClone(state.journal);
  const forgedQuery = forgedQueryJournal.findLast(
    (entry) => entry.kind === 'QUERY',
  );
  forgedQuery.terminalStatus = 'CANCELLED';
  forgedQuery.cumulativeFilledQuantityExact = '0.1';
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, forgedQueryJournal).ok,
    false,
  );
});

test('aggregate journal bytes cap repeated full query provenance', () => {
  const { binding } = bindingFixture();
  let state = throughBothOpenLegs(binding);
  const close = prepareUsdM(
    binding,
    'PERP_CLOSE',
    0,
    state.expectedQuantityExact,
  );
  state = validate(state, binding, 'PERP_CLOSE', 0, close.result);
  state = outcome(state, binding, 'PERP_CLOSE', 0, 'AMBIGUOUS');
  const queryDescriptorResult =
    close.adapter.buildOrderQueryDescriptor(close.result.intent);
  const evidence = foundEvidence(close.result.intent, {
    order: { status: 'NEW', executedQty: '0' },
  });
  const resolution = normalizeUsdMQuery(close, evidence);
  let refusal = null;
  for (let index = 0; index < 128; index += 1) {
    const result = applyBasisValidateOnlyObservation(
      binding,
      state,
      {
        kind: 'QUERY',
        step: 'PERP_CLOSE',
        attempt: 0,
        clientOrderId: state.activeClientOrderId,
        adapterResult: close.result,
        queryDescriptorResult,
        queryResolution: resolution,
        queryInvocation: queryInvocations.get(resolution),
      },
    );
    if (!result.applied) {
      refusal = result;
      break;
    }
    state = result.state;
  }
  assert.ok(refusal, 'journal byte cap must precede 128 full invocations');
  assert.equal(refusal.code, 'JOURNAL_FULL');
  assert.equal(refusal.state, state);
  assert.ok(
    serializeBasisValidateOnlyCheckpoint(binding, state).length <
      512 * 1_024,
  );
});

test('Spot ambiguity recovery consumes the embedded same-ID descriptor', () => {
  const { binding } = bindingFixture();
  let state = throughPerpClose(binding);
  const preparation = prepareSpot(
    binding,
    'SPOT_CLOSE',
    0,
    state.expectedQuantityExact,
  );
  state = validate(state, binding, 'SPOT_CLOSE', 0, preparation);
  state = outcome(state, binding, 'SPOT_CLOSE', 0, 'AMBIGUOUS');
  const clientOrderId = state.activeClientOrderId;
  const queryInput = deepFreeze({
      evaluatedAtMs: NOW,
      mutationKnowledge: 'KNOWN_SUBMITTED',
      evidence: {
        outcome: 'FOUND',
        observedAt: spotStamp('binance.spot.query.m1-i1'),
        symbol: binding.symbol,
        clientOrderId,
        venueOrderId: '9001',
        side: preparation.wireIntent.side,
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: preparation.wireIntent.quantity,
        price: preparation.wireIntent.price,
        executedQuantity: preparation.wireIntent.quantity,
        status: 'FILLED',
      },
  });
  const queryResolution = normalizeSpotQuery(preparation, queryInput);
  assert.equal(queryResolution.state, 'OBSERVED');
  state = apply(state, binding, {
    kind: 'QUERY',
    step: 'SPOT_CLOSE',
    attempt: 0,
    clientOrderId,
    adapterResult: preparation,
    queryDescriptorResult: null,
    queryResolution,
    queryInvocation: queryInvocations.get(queryResolution),
  });
  assert.equal(state.next, 'FLATNESS');
  assert.equal(state.activeClientOrderId, null);
});

test('replay rejects adapter swaps, accessors, and custom iterators without invocation', () => {
  const { binding } = bindingFixture();
  let state = createBasisValidateOnlyLifecycle(binding);
  state = validate(
    state,
    binding,
    'SPOT_OPEN',
    0,
    prepareSpot(binding, 'SPOT_OPEN', 0, '0.3'),
  );
  const swapped = structuredClone(state.journal);
  swapped[0].adapter = 'BINANCE_USDM';
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, swapped).ok,
    false,
  );
  const forgedEvidence = structuredClone(state.journal);
  forgedEvidence[0].evidenceId = 'forged_no_adapter';
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, forgedEvidence).ok,
    false,
  );

  let kindGetterCalls = 0;
  const accessorEntry = {};
  Object.defineProperty(accessorEntry, 'kind', {
    enumerable: true,
    get() {
      kindGetterCalls += 1;
      return 'VALIDATION';
    },
  });
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, [accessorEntry]).ok,
    false,
  );
  assert.equal(kindGetterCalls, 0);

  let prototypeOwnKeysCalls = 0;
  const hostilePrototype = new Proxy({}, {
    ownKeys() {
      prototypeOwnKeysCalls += 1;
      return [];
    },
  });
  const inheritedEntry = Object.create(hostilePrototype);
  Object.defineProperty(inheritedEntry, 'kind', {
    enumerable: true,
    value: 'VALIDATION',
  });
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, [inheritedEntry]).ok,
    false,
  );
  assert.equal(prototypeOwnKeysCalls, 0);

  let iteratorCalls = 0;
  const customIterator = [];
  Object.defineProperty(customIterator, Symbol.iterator, {
    enumerable: false,
    value() {
      iteratorCalls += 1;
      return [][Symbol.iterator]();
    },
  });
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, customIterator).ok,
    false,
  );
  assert.equal(iteratorCalls, 0);

  let nestedGetterCalls = 0;
  const hostileInput = {};
  Object.defineProperty(hostileInput, 'evidence', {
    enumerable: true,
    get() {
      nestedGetterCalls += 1;
      return {};
    },
  });
  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, [{
      kind: 'FLATNESS',
      input: hostileInput,
      proofId: `bflat_${'0'.repeat(32)}`,
    }]).ok,
    false,
  );
  assert.equal(nestedGetterCalls, 0);

  assert.equal(
    replayBasisValidateOnlyLifecycle(binding, [{
      kind: 'FLATNESS',
      input: { oversized: 'x'.repeat(600_000) },
      proofId: `bflat_${'0'.repeat(32)}`,
    }]).ok,
    false,
  );
});

test('exact four-leg path restores ambiguity, queries the same ID, and proves flat', () => {
  const { binding } = bindingFixture();
  let state = createBasisValidateOnlyLifecycle(binding);

  const spotOpen = prepareSpot(binding, 'SPOT_OPEN', 0, '0.3');
  state = validate(state, binding, 'SPOT_OPEN', 0, spotOpen);
  state = outcome(
    state,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );

  const perpOpen = prepareUsdM(binding, 'PERP_OPEN', 0, '0.3');
  state = validate(state, binding, 'PERP_OPEN', 0, perpOpen.result);
  state = outcome(
    state,
    binding,
    'PERP_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );

  const close0 = prepareUsdM(binding, 'PERP_CLOSE', 0, '0.3');
  state = validate(state, binding, 'PERP_CLOSE', 0, close0.result);
  state = outcome(
    state,
    binding,
    'PERP_CLOSE',
    0,
    'AMBIGUOUS',
  );
  assert.equal(state.action.disposition, 'QUERY_REQUIRED');
  const ambiguousId = state.activeClientOrderId;

  const checkpoint = serializeBasisValidateOnlyCheckpoint(binding, state);
  const restored = restoreBasisValidateOnlyCheckpoint(binding, checkpoint);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  state = restored.state;
  assert.equal(state.action.disposition, 'QUERY_REQUIRED');
  assert.equal(state.activeClientOrderId, ambiguousId);
  assert.equal(state.action.clientOrderId, ambiguousId);

  const canceledEvidence = foundEvidence(close0.result.intent, {
    order: {
      status: 'CANCELED',
      executedQty: '0.10000000',
    },
  });
  const canceled = normalizeUsdMQuery(close0, canceledEvidence);
  const queryDescriptorResult =
    close0.adapter.buildOrderQueryDescriptor(close0.result.intent);
  assert.equal(queryDescriptorResult.ok, true);
  assert.equal(queryDescriptorResult.descriptor.callable, false);
  assert.equal(
    queryDescriptorResult.descriptor.origClientOrderId,
    ambiguousId,
  );
  const withoutNominalDescriptor = applyBasisValidateOnlyObservation(
    binding,
    state,
    {
      kind: 'QUERY',
      step: 'PERP_CLOSE',
      attempt: 0,
      clientOrderId: ambiguousId,
      adapterResult: close0.result,
      queryDescriptorResult: null,
      queryResolution: canceled,
      queryInvocation: queryInvocations.get(canceled),
    },
  );
  assert.equal(withoutNominalDescriptor.applied, false);
  assert.equal(withoutNominalDescriptor.code, 'IDENTITY_MISMATCH');
  assert.equal(withoutNominalDescriptor.state, state);
  state = apply(state, binding, {
    kind: 'QUERY',
    step: 'PERP_CLOSE',
    attempt: 0,
    clientOrderId: ambiguousId,
    adapterResult: close0.result,
    queryDescriptorResult,
    queryResolution: canceled,
    queryInvocation: queryInvocations.get(canceled),
  });
  assert.equal(state.next, 'PERP_CLOSE');
  assert.equal(state.attempt, 1);
  assert.equal(state.expectedQuantityExact, '0.2');
  assert.notEqual(
    state.expectedQuantityExact,
    '0.19999999999999998',
  );

  const close1 = prepareUsdM(binding, 'PERP_CLOSE', 1, '0.2');
  state = validate(state, binding, 'PERP_CLOSE', 1, close1.result);
  state = outcome(
    state,
    binding,
    'PERP_CLOSE',
    1,
    'TERMINAL',
    'FILLED',
    '0.2',
  );
  assert.equal(state.next, 'SPOT_CLOSE');

  const spotClose = prepareSpot(binding, 'SPOT_CLOSE', 0, '0.3');
  state = validate(state, binding, 'SPOT_CLOSE', 0, spotClose);
  state = outcome(
    state,
    binding,
    'SPOT_CLOSE',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  assert.equal(state.next, 'FLATNESS');
  assert.equal(state.action.disposition, 'FLATNESS_REQUIRED');

  const input = flatnessInput(binding, state);
  const flatness = verifyBasisFlatness(input);
  assert.equal(flatness.status, 'FLAT', JSON.stringify(flatness));
  const contradictoryInput = structuredClone(input);
  contradictoryInput.evidence.orders.records[2]
    .cumulativeFilledQuantityExact = '0.05';
  contradictoryInput.evidence.orders.records[3]
    .submittedQuantityExact = '0.25';
  contradictoryInput.evidence.orders.records[3]
    .cumulativeFilledQuantityExact = '0.25';
  deepFreeze(contradictoryInput);
  const contradictoryFlatness = verifyBasisFlatness(contradictoryInput);
  assert.equal(
    contradictoryFlatness.status,
    'FLAT',
    JSON.stringify(contradictoryFlatness),
  );
  const contradictionRefused = applyBasisValidateOnlyObservation(
    binding,
    state,
    {
      kind: 'FLATNESS',
      input: contradictoryInput,
      result: contradictoryFlatness,
    },
  );
  assert.equal(contradictionRefused.applied, false);
  assert.equal(contradictionRefused.code, 'FLATNESS_INVALID');
  assert.equal(contradictionRefused.state, state);
  state = apply(state, binding, {
    kind: 'FLATNESS',
    input,
    result: flatness,
  });

  assert.equal(state.complete, true);
  assert.equal(state.next, 'COMPLETE');
  assert.equal(state.action.disposition, 'COMPLETE');
  assert.match(state.flatnessProofId, /^bflat_[0-9a-f]{32}$/);
  assert.deepEqual(state.terminalFilledExact, {
    SPOT_OPEN: '0.3',
    PERP_OPEN: '0.3',
    PERP_CLOSE: '0.3',
    SPOT_CLOSE: '0.3',
  });
  assert.equal(state.sendEligible, false);
  assert.equal(state.sendsPerformed, 0);
  assert.equal(state.sideEffectsPerformed, 0);

  const completedCheckpoint =
    serializeBasisValidateOnlyCheckpoint(binding, state);
  const completedDecoded = JSON.parse(completedCheckpoint);
  const completedReplay = replayBasisValidateOnlyLifecycle(
    binding,
    completedDecoded.journal,
  );
  assert.equal(completedReplay.ok, true, JSON.stringify(completedReplay));
  const completedRestore =
    restoreBasisValidateOnlyCheckpoint(binding, completedCheckpoint);
  assert.equal(completedRestore.ok, true, JSON.stringify(completedRestore));
  assert.equal(completedRestore.state.complete, true);
  assert.equal(completedRestore.state.flatnessProofId, state.flatnessProofId);
  const postComplete = applyBasisValidateOnlyObservation(
    binding,
    state,
    {
      kind: 'FLATNESS',
      input,
      result: flatness,
    },
  );
  assert.equal(postComplete.applied, false);
  assert.equal(postComplete.code, 'FLATNESS_INVALID');
});

test('unresolved query remains blocked on the same identity and cannot retry', () => {
  const { binding } = bindingFixture();
  let state = createBasisValidateOnlyLifecycle(binding);
  const spotOpen = prepareSpot(binding, 'SPOT_OPEN', 0, '0.3');
  state = validate(state, binding, 'SPOT_OPEN', 0, spotOpen);
  state = outcome(
    state,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const perpOpen = prepareUsdM(binding, 'PERP_OPEN', 0, '0.3');
  state = validate(state, binding, 'PERP_OPEN', 0, perpOpen.result);
  state = outcome(
    state,
    binding,
    'PERP_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const close0 = prepareUsdM(binding, 'PERP_CLOSE', 0, '0.3');
  state = validate(state, binding, 'PERP_CLOSE', 0, close0.result);
  state = outcome(state, binding, 'PERP_CLOSE', 0, 'AMBIGUOUS');
  const sameId = state.activeClientOrderId;

  const unresolvedEvidence = foundEvidence(close0.result.intent, {
    outcome: 'TIMEOUT',
    omitOrder: true,
  });
  const unresolved = normalizeUsdMQuery(close0, unresolvedEvidence);
  state = apply(state, binding, {
    kind: 'QUERY',
    step: 'PERP_CLOSE',
    attempt: 0,
    clientOrderId: sameId,
    adapterResult: close0.result,
    queryDescriptorResult:
      close0.adapter.buildOrderQueryDescriptor(close0.result.intent),
    queryResolution: unresolved,
    queryInvocation: queryInvocations.get(unresolved),
  });
  assert.equal(state.action.disposition, 'RECOVERY_BLOCKED');
  assert.equal(state.action.blockerCode, 'SAME_ID_QUERY_UNRESOLVED');
  assert.equal(state.activeClientOrderId, sameId);
  assert.equal(state.attempt, 0);

  const forgedRetry = prepareUsdM(binding, 'PERP_CLOSE', 1, '0.3');
  const refused = applyBasisValidateOnlyObservation(
    binding,
    state,
    {
      kind: 'VALIDATION',
      step: 'PERP_CLOSE',
      attempt: 1,
      adapterResult: forgedRetry.result,
      adapterInvocation: adapterInvocations.get(forgedRetry.result),
    },
  );
  assert.equal(refused.applied, false);
  assert.equal(refused.code, 'UNEXPECTED_EVENT');
  assert.equal(refused.state.activeClientOrderId, sameId);
});

test('close attempt budget stops after the fourth immutable identity', () => {
  const { binding } = bindingFixture();
  let state = createBasisValidateOnlyLifecycle(binding);
  const spot = prepareSpot(binding, 'SPOT_OPEN', 0, '0.3');
  state = validate(state, binding, 'SPOT_OPEN', 0, spot);
  state = outcome(
    state,
    binding,
    'SPOT_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );
  const perp = prepareUsdM(binding, 'PERP_OPEN', 0, '0.3');
  state = validate(state, binding, 'PERP_OPEN', 0, perp.result);
  state = outcome(
    state,
    binding,
    'PERP_OPEN',
    0,
    'TERMINAL',
    'FILLED',
    '0.3',
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const expected = state.expectedQuantityExact;
    const close = prepareUsdM(
      binding,
      'PERP_CLOSE',
      attempt,
      expected,
    );
    state = validate(
      state,
      binding,
      'PERP_CLOSE',
      attempt,
      close.result,
    );
    state = outcome(
      state,
      binding,
      'PERP_CLOSE',
      attempt,
      'TERMINAL',
      'CANCELLED',
      '0',
    );
  }
  assert.equal(state.action.disposition, 'ATTEMPT_BUDGET_EXHAUSTED');
  assert.equal(state.attempt, null);
  assert.equal(state.expectedQuantityExact, '0.3');
  assert.equal(state.action.clientOrderId, null);
  assert.equal(
    binding.plan.normalBasisBinding.closeAttempts.filter(
      (candidate) => candidate.step === 'PERP_CLOSE',
    ).length,
    4,
  );
});

test('checkpoint checksum and projection mismatch fail closed', () => {
  const { binding } = bindingFixture();
  const state = createBasisValidateOnlyLifecycle(binding);
  const checkpoint = serializeBasisValidateOnlyCheckpoint(binding, state);
  const decoded = JSON.parse(checkpoint);

  const checksumTamper = JSON.stringify({
    ...decoded,
    checksum: '0'.repeat(32),
  });
  assert.deepEqual(
    restoreBasisValidateOnlyCheckpoint(binding, checksumTamper),
    { ok: false, code: 'CHECKSUM_MISMATCH' },
  );

  const projectionTamper = {
    ...decoded,
    projection: {
      ...decoded.projection,
      sendsPerformed: 1,
    },
  };
  // A public checksum can establish integrity, not issuer authenticity. Even
  // with a recomputed checksum, restore must replay and byte-compare projection.
  const payload = {
    schema: projectionTamper.schema,
    version: projectionTamper.version,
    bindingId: projectionTamper.bindingId,
    journal: projectionTamper.journal,
    projection: projectionTamper.projection,
  };
  projectionTamper.checksum = stableHash128Hex(
    `basisValidateOnlyCheckpoint|${canonicalJson(payload)}`,
  );
  assert.deepEqual(
    restoreBasisValidateOnlyCheckpoint(
      binding,
      JSON.stringify(projectionTamper),
    ),
    { ok: false, code: 'REPLAY_MISMATCH' },
  );
});
