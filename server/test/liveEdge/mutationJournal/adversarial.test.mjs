import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';
import { deriveClientOrderId } from '../../../dist/foundation/contracts/exchange.js';
import { deriveTransportRequestId } from '../../../dist/liveEdge/adapters/binanceSignedKernel/identity.js';
import {
  createRequestAttempt,
  reduceRequestAttempt,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';
import { createSpotRealmBoundRevision } from '../../../dist/liveEdge/adapters/binancePrivateTruth/spotLifecycle.js';
import {
  buildMutationReconciliationHandoff,
  confirmMutationAppend,
  evaluateSyntheticSubmissionBoundary,
  mutationObservationId,
  prepareInitialMutationAppend,
  prepareMutationObservationAppend,
  preparePreflightMutationAppend,
  prepareSubmissionIntentAppend,
  prepareSyntheticSubmissionObservationAppend,
  reconstructPersistedMutationJournal,
  validatePersistedMutationJournal,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/journal.js';
import {
  CAPITAL_EVIDENCE_DIMENSIONS,
  buildCapitalEvidenceCandidate,
  buildFullChainLatencyEvidence,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/section7.js';
import { foundationReconciliationObservation as canonicalReconciliationObservation } from './fixtures.mjs';

const T0 = 1_800_000_000_000;
const PLAN_ID = `plan_${'1'.repeat(16)}`;
const LEG_ID = `leg_${'2'.repeat(16)}`;
const CLIENT_ORDER_ID = deriveClientOrderId({ planId: PLAN_ID, legId: LEG_ID, attempt: 0 });

function submittedAttempt(current) {
  const created = createRequestAttempt({
    requestId: current.snapshot.identity.requestId,
    clientOrderId: current.snapshot.identity.clientOrderId,
  });
  const result = reduceRequestAttempt(created, { kind: 'SUBMIT' });
  assert.equal(result.applied, true);
  return result.state;
}

function httpAttempt(current, payload) {
  const submitted = submittedAttempt(current);
  let outcome = 'SUCCESS';
  let disconnected = false;
  if (payload.classification === 'REJECTED_RESPONSE' || payload.classification === 'PARTIAL_MIXED') {
    outcome = 'REJECTED';
  } else if (payload.classification === 'AMBIGUOUS') {
    if (payload.ambiguityCause === 'TRANSPORT_TIMEOUT') outcome = 'TIMEOUT';
    else if (payload.ambiguityCause === 'TRANSPORT_DISCONNECTED') {
      outcome = 'AMBIGUOUS';
      disconnected = true;
    } else if (payload.ambiguityCause === 'TRANSPORT_ABORTED_AFTER_DISPATCH') outcome = 'ABORTED';
    else if (payload.ambiguityCause === 'MALFORMED_RESPONSE_AFTER_DISPATCH') outcome = 'MALFORMED';
    else outcome = 'AMBIGUOUS';
  }
  const observed = reduceRequestAttempt(submitted, {
    kind: 'TRANSPORT_OBSERVED',
    outcome,
    httpStatus: payload.httpStatus,
    disconnected,
  });
  assert.equal(observed.applied, true, JSON.stringify(payload));
  return observed.state;
}

function createInput(validUntilMs = T0 + 1_000) {
  const requestSequence = 0;
  const intentFingerprint = '8'.repeat(32);
  const requestIdentity = deriveTransportRequestId({
    contractId: 'SPOT_ORDER_POST',
    product: 'SPOT',
    environment: 'PRODUCTION',
    signerProfile: 'SPOT_HMAC_SHA256',
    correlationId: `cor_${'3'.repeat(16)}`,
    requestSequence,
    intentFingerprint,
  });
  const preflightResult = {
    schema: 'BINANCE_STATIC_FILTER_PREFLIGHT_V1',
    staticState: 'PASS',
    reasonCodes: [],
    instrumentRevision: `l04-instrument-spec:${'1'.repeat(24)}`,
    sourceEvidenceRevision: `l04-instrument-source-evidence:${'2'.repeat(24)}`,
    registryRevision: `l04-instrument-registry:${'3'.repeat(24)}`,
    snapshotRevision: `l04-instrument-registry-snapshot:${'4'.repeat(24)}`,
    referenceEvidenceRevision: null,
    evaluatedAtMs: T0 - 20,
    instrumentValidUntilMs: validUntilMs,
    referenceObservedAtMs: null,
    referenceValidUntilMs: null,
    notionalAsset: 'USDT',
    requestedPrice: '9.5',
    validationPrice: '9.5',
    requestedQuantity: '1',
    resultQuantity: '1',
    resultNotional: '9.5',
    effectiveNotionalCeiling: '10',
    transformations: [],
    externalRequirements: [],
    canaryMaximumNotional: '10',
    sendEligible: false,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
  };
  const preflightContentRevision = `l06l04binding_${createHash('sha256')
    .update(canonicalJson(preflightResult)).digest('hex')}`;
  return {
    identity: {
      globalCorrelationId: `cor_${'3'.repeat(16)}`,
      assessmentId: 'asm_evidence_1',
      decisionId: `cdec_${'4'.repeat(16)}`,
      strategyId: 'BASIS',
      proposalId: `cprop_${'5'.repeat(16)}`,
      capitalMandateId: `cmdt_${'6'.repeat(32)}`,
      capitalReservationId: `cres_${'7'.repeat(32)}`,
      ticketId: PLAN_ID,
      legId: LEG_ID,
      requestId: requestIdentity.requestId,
      requestSequence,
      intentFingerprint,
      signerProfile: 'SPOT_HMAC_SHA256',
      clientOrderId: CLIENT_ORDER_ID,
      attempt: 0,
      product: 'SPOT',
      environment: 'PRODUCTION',
      accountRealmId: 'realm-production-primary',
      symbol: 'BTCUSDT',
      mutationKind: 'PLACE_ORDER',
      contractId: 'SPOT_ORDER_POST',
      contractState: 'CURRENT',
    },
    bindings: {
      instrumentRevision: preflightResult.instrumentRevision,
      sourceEvidenceRevision: preflightResult.sourceEvidenceRevision,
      registryRevision: preflightResult.registryRevision,
      snapshotRevision: preflightResult.snapshotRevision,
      referenceEvidenceRevision: null,
      preflightContentRevision,
      preflightResultQuantity: '1',
      preflightResultNotional: '9.5',
      preflightNotionalAsset: 'USDT',
      preflightCanaryMaximumNotional: '10',
      sanitizedRequestContentHash: `sha256:${'9'.repeat(64)}`,
      privateProjectionRevision: `l05proj_${'a'.repeat(64)}`,
      privateSourceCutRevision: `l05pcut_${'b'.repeat(64)}`,
      lifecycleRevisions: [`l05lifecycle_${'c'.repeat(64)}`],
      foundationReconciliationResultRevision: `foundation-reconciliation-result:${'d'.repeat(24)}`,
      capitalMandateRevision: 'capital-mandate-revision:fixture-0001',
      riskVerdictRevision: 'risk-verdict-revision:fixture-0001',
      regimeAdvisoryRevision: null,
      regimePostureState: 'UNKNOWN',
      sourceExchangeEventAtMs: T0 - 100,
      sourceLocalReceiveAtMs: T0 - 90,
      featuresReadyAtMs: T0 - 80,
      decisionAtMs: T0 - 70,
      approvalAtMs: T0 - 30,
      timingEvidenceRevision: 'timing-evidence:fixture-0001',
      exchangeClockCalibrationRevision: 'l03-clock-calibration:fixture-0001',
      preflightEvaluatedAtMs: T0 - 20,
      privateEvaluatedAtMs: T0 - 10,
      validUntilMs,
      preflightState: 'CURRENT_NON_SENDABLE',
    },
    preflightResult,
    requestedQuantity: '1',
    createdAtMs: T0,
  };
}

function committedAcknowledgement(prepared, overrides = {}) {
  const { request, nextSnapshot } = prepared;
  return {
    schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1',
    version: 1,
    owner: 'SYSTEM_INTEGRATION_LEDGER',
    disposition: 'COMMITTED_NEW',
    mutationId: request.mutationId,
    entryId: request.entryId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    expectedJournalVersion: request.expectedJournalVersion,
    committedJournalVersion: request.nextJournalVersion,
    previousHeadDigest: request.previousHeadDigest,
    committedHeadDigest: request.nextHeadDigest,
    committedOutcomeRevision: request.nextOutcomeRevision,
    appendedCount: 1,
    ledgerEventId: 10_000 + request.nextJournalVersion,
    committedAtMs: nextSnapshot.entries.at(-1).receivedAtMs + 1,
    failureCode: null,
    externalActionAuthorization: 'NONE',
    ...overrides,
  };
}

function commit(prepared, overrides = {}) {
  const result = confirmMutationAppend(
    prepared,
    committedAcknowledgement(prepared, overrides),
  );
  assert.equal(result.ok, true, result.reasonCode);
  return result.persisted;
}

function journalAt(stage = 'SUBMITTED', validUntilMs = T0 + 1_000) {
  const created = commit(prepareInitialMutationAppend(createInput(validUntilMs)));
  if (stage === 'CREATED') return created;
  const preflighted = commit(preparePreflightMutationAppend(created, T0 + 2));
  if (stage === 'PREFLIGHTED') return preflighted;
  const intent = commit(prepareSubmissionIntentAppend(preflighted, T0 + 4));
  if (stage === 'INTENT') return intent;
  const decision = evaluateSyntheticSubmissionBoundary(intent, T0 + 6);
  assert.equal(decision.state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  return commit(prepareSyntheticSubmissionObservationAppend(
    intent,
    decision,
    submittedAttempt(intent),
    T0 + 8,
  ));
}

function observationInput(current, kind, payload, atMs, marker) {
  let normalizedPayload = kind === 'HTTP_OBSERVED' && Object.hasOwn(payload, 'classification')
    ? (() => {
        const l03RequestAttempt = httpAttempt(current, payload);
        return {
          l03RequestAttempt,
          partialMixed: payload.classification === 'PARTIAL_MIXED',
          venueOrderId: payload.venueOrderId,
          responseContentRevision: l03RequestAttempt.httpStatus === null
            ? null
            : payload.responseContentRevision,
        };
      })()
    : payload;
  if (kind === 'PRIVATE_ORDER_OBSERVED' || kind === 'PRIVATE_FILL_OBSERVED') {
    const privateEventKind = kind === 'PRIVATE_ORDER_OBSERVED' ? 'ORDER' : 'FILL';
    const privateReceiptTimeMs = atMs;
    const fact = kind === 'PRIVATE_ORDER_OBSERVED'
      ? {
          status: normalizedPayload.status,
          cumulativeFilledQuantity: normalizedPayload.cumulativeFilledQuantity,
          venueOrderId: normalizedPayload.venueOrderId,
          exchangeEventTimeMs: normalizedPayload.exchangeEventTimeMs,
          connectionGeneration: normalizedPayload.connectionGeneration,
        }
      : {
          tradeId: normalizedPayload.tradeId,
          fillQuantity: normalizedPayload.fillQuantity,
          cumulativeFilledQuantity: normalizedPayload.cumulativeFilledQuantity,
          venueOrderId: normalizedPayload.venueOrderId,
          exchangeEventTimeMs: normalizedPayload.exchangeEventTimeMs,
          connectionGeneration: normalizedPayload.connectionGeneration,
        };
    const privateContentRevision = `spot_content_${createHash('sha256')
      .update(canonicalJson({
        schema: kind === 'PRIVATE_ORDER_OBSERVED'
          ? 'L06_PRIVATE_ORDER_FACT_PROJECTION_V1'
          : 'L06_PRIVATE_FILL_FACT_PROJECTION_V1',
        product: normalizedPayload.product,
        accountRealmId: normalizedPayload.accountRealmId,
        symbol: normalizedPayload.symbol,
        clientOrderId: normalizedPayload.clientOrderId,
        ...fact,
      })).digest('hex').slice(0, 32)}`;
    normalizedPayload = {
      ...normalizedPayload,
      privateContentRevision,
      privateEventKind,
      privateEventRevision: createSpotRealmBoundRevision(
        'spot_event',
        normalizedPayload.accountRealmId,
        {
          generation: normalizedPayload.connectionGeneration,
          eventKind: privateEventKind,
          contentRevision: privateContentRevision,
          exchangeEventTimeMs: normalizedPayload.exchangeEventTimeMs,
          receiptTimeMs: privateReceiptTimeMs,
        },
      ),
      privateReceiptTimeMs,
      privateTransactionTimeMs: null,
      privateSemanticCategory: null,
      privateOrderExecutionType: null,
      privateIsFill: null,
    };
  }
  const occurredAtMs = kind === 'PRIVATE_ORDER_OBSERVED' || kind === 'PRIVATE_FILL_OBSERVED'
    ? normalizedPayload.exchangeEventTimeMs
    : kind === 'FOUNDATION_RECONCILIATION_OBSERVED'
      ? normalizedPayload.observedAtMs
      : atMs;
  const sourceRevision = kind === 'HTTP_OBSERVED'
    ? `l06l03binding_${createHash('sha256').update(canonicalJson(normalizedPayload.l03RequestAttempt)).digest('hex')}`
    : kind === 'PRIVATE_ORDER_OBSERVED' || kind === 'PRIVATE_FILL_OBSERVED'
      ? normalizedPayload.privateEventRevision
      : kind === 'FOUNDATION_RECONCILIATION_OBSERVED'
        ? normalizedPayload.resultRevision
      : `l06-test-source:${marker}`;
  const input = {
    kind,
    occurredAtMs,
    receivedAtMs: atMs,
    sourceRevision,
    payload: normalizedPayload,
  };
  return {
    observationId: mutationObservationId(current, input),
    ...input,
  };
}

function appendObservation(current, kind, payload, atMs, marker) {
  const result = prepareMutationObservationAppend(
    current,
    observationInput(current, kind, payload, atMs, marker),
  );
  assert.equal(result.kind, 'PREPARED');
  return commit(result.prepared);
}

function privateOrderPayload({
  status = 'PARTIALLY_FILLED',
  cumulative = '0.5',
  venueOrderId = '42',
  exchangeEventTimeMs = T0 + 10,
  generation = 1,
  revisionCharacter = '1',
} = {}) {
  return {
    product: 'SPOT',
    accountRealmId: 'realm-production-primary',
    symbol: 'BTCUSDT',
    clientOrderId: CLIENT_ORDER_ID,
    status,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration: generation,
    privateLifecycleRevision: `l05lifecycle_${'c'.repeat(64)}`,
    privateContentRevision: `spot_content_${revisionCharacter.repeat(32)}`,
  };
}

function privateFillPayload({
  tradeId,
  fill,
  cumulative,
  exchangeEventTimeMs,
  revisionCharacter,
  venueOrderId = '42',
} = {}) {
  return {
    product: 'SPOT',
    accountRealmId: 'realm-production-primary',
    symbol: 'BTCUSDT',
    clientOrderId: CLIENT_ORDER_ID,
    tradeId,
    fillQuantity: fill,
    cumulativeFilledQuantity: cumulative,
    venueOrderId,
    exchangeEventTimeMs,
    connectionGeneration: 1,
    privateLifecycleRevision: `l05lifecycle_${'c'.repeat(64)}`,
    privateContentRevision: `spot_content_${revisionCharacter.repeat(32)}`,
  };
}

function reconciliationPayload(current, effect, character, quantity = '0') {
  return canonicalReconciliationObservation(current, {
    label: `adversarial-${character}`,
    effect,
    resultRevision: `foundation-reconciliation-result:${character.repeat(24)}`,
    cumulativeFilledQuantity: quantity,
    venueOrderId: effect === 'ACKNOWLEDGED' || effect === 'REJECTED_NO_EFFECT_PROVEN'
      || effect === 'UNKNOWN' || effect === 'PARTIAL_MIXED'
      ? null
      : '42',
    observedAtMs: T0 + 20,
  }).payload;
}

function assertObservationNotAcceptedAsCompatible(current, input) {
  try {
    const result = prepareMutationObservationAppend(current, input);
    if (result.kind === 'PREPARED') {
      assert.equal(result.prepared.nextSnapshot.projection.lifecycle, 'CONFLICT');
      assert.ok(result.prepared.nextSnapshot.projection.conflictCodes.length > 0);
    }
  } catch (error) {
    assert.ok(error instanceof TypeError || error instanceof RangeError);
  }
}

test('private order and fill evidence require a non-null venue order identity', () => {
  const submitted = journalAt('SUBMITTED');
  for (const [kind, payload, marker] of [
    ['PRIVATE_ORDER_OBSERVED', privateOrderPayload({ venueOrderId: null }), 'null-order-id'],
    ['PRIVATE_FILL_OBSERVED', privateFillPayload({
      tradeId: '1',
      fill: '0.5',
      cumulative: '0.5',
      exchangeEventTimeMs: T0 + 10,
      revisionCharacter: '2',
      venueOrderId: null,
    }), 'null-fill-order-id'],
  ]) {
    assert.throws(
      () => prepareMutationObservationAppend(
        submitted,
        observationInput(submitted, kind, payload, T0 + 12, marker),
      ),
      TypeError,
    );
  }
});

test('ACKNOWLEDGED, NEW, and PARTIALLY_FILLED owner effects never become RECONCILED', () => {
  for (const [effect, quantity, character] of [
    ['ACKNOWLEDGED', '0', '3'],
    ['NEW', '0', '4'],
    ['PARTIALLY_FILLED', '0.5', '5'],
  ]) {
    const submitted = journalAt('SUBMITTED');
    const payload = reconciliationPayload(submitted, effect, character, quantity);
    const reconciled = appendObservation(
      submitted,
      'FOUNDATION_RECONCILIATION_OBSERVED',
      payload,
      payload.observedAtMs,
      `incomplete-${effect}`,
    );
    assert.equal(reconciled.snapshot.projection.reconciled, false);
    assert.notEqual(reconciled.snapshot.projection.lifecycle, 'RECONCILED');
    assert.equal(reconciled.snapshot.projection.recoveryRequired, true);
  }
});

test('persisted-head validation recomputes every acknowledgement binding and commit causality', () => {
  const persisted = journalAt('PREFLIGHTED');
  const forgeries = [
    { idempotencyKey: 'l06append:foreign:2' },
    { appendRequestDigest: `l06append_${'f'.repeat(64)}` },
    { expectedJournalVersion: 0 },
    { previousHeadDigest: null },
    { committedAtMs: 0 },
  ];
  for (const patch of forgeries) {
    const forged = {
      ...persisted,
      acknowledgement: { ...persisted.acknowledgement, ...patch },
    };
    assert.throws(() => validatePersistedMutationJournal(forged), TypeError);
    assert.equal(
      reconstructPersistedMutationJournal(forged.snapshot.entries, forged.acknowledgement),
      null,
    );
  }
});

test('cold reconstruction cannot reopen a COMMITTED_NEW synthetic submission boundary', () => {
  const intent = journalAt('INTENT');
  assert.equal(evaluateSyntheticSubmissionBoundary(intent, T0 + 6).state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');

  const reconstructed = reconstructPersistedMutationJournal(
    intent.snapshot.entries,
    intent.acknowledgement,
  );
  assert.ok(reconstructed);
  const afterRestart = evaluateSyntheticSubmissionBoundary(reconstructed, T0 + 6);
  assert.equal(afterRestart.state, 'BLOCKED');
  assert.ok(afterRestart.reasonCodes.some((code) => /REPLAY|RESTART|RECOVERY/.test(code)));
});

test('crash reconstruction preserves exact truth at every money-critical append state', () => {
  const created = journalAt('CREATED');
  const preflighted = journalAt('PREFLIGHTED');
  const intent = journalAt('INTENT');
  const submitted = journalAt('SUBMITTED');
  const unknown = appendObservation(submitted, 'HTTP_OBSERVED', {
    classification: 'AMBIGUOUS',
    httpStatus: 500,
    ambiguityCause: 'HTTP_5XX',
    venueOrderId: null,
    responseContentRevision: `sha256:${'7'.repeat(64)}`,
  }, T0 + 12, 'crash-unknown');
  const partiallyFilled = appendObservation(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({ cumulative: '0.4', exchangeEventTimeMs: T0 + 10, revisionCharacter: 'f' }),
    T0 + 12,
    'crash-partial',
  );
  const terminal = appendObservation(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({
      status: 'FILLED',
      cumulative: '1',
      exchangeEventTimeMs: T0 + 10,
      revisionCharacter: '0',
    }),
    T0 + 12,
    'crash-terminal',
  );
  const reconciledPayload = reconciliationPayload(terminal, 'FILLED', 'e', '1');
  const reconciled = appendObservation(
    terminal,
    'FOUNDATION_RECONCILIATION_OBSERVED',
    reconciledPayload,
    reconciledPayload.observedAtMs,
    'crash-reconciled',
  );

  for (const state of [created, preflighted, intent, submitted, unknown, partiallyFilled, terminal, reconciled]) {
    const rebuilt = reconstructPersistedMutationJournal(
      state.snapshot.entries,
      state.acknowledgement,
    );
    assert.ok(rebuilt, state.snapshot.projection.lifecycle);
    assert.deepEqual(rebuilt.snapshot.projection, state.snapshot.projection);
    assert.equal(rebuilt.snapshot.outcomeRevision, state.snapshot.outcomeRevision);
    assert.equal(rebuilt.snapshot.headDigest, state.snapshot.headDigest);
    assert.equal(
      evaluateSyntheticSubmissionBoundary(rebuilt, T0 + 30).state,
      'BLOCKED',
      state.snapshot.projection.lifecycle,
    );
  }
});

test('possible exchange effect after durable intent requires recovery even if the submission marker was lost', () => {
  const intent = journalAt('INTENT');
  const httpPayload = {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'1'.repeat(64)}`,
  };
  const acknowledged = appendObservation(
    intent,
    'HTTP_OBSERVED',
    httpPayload,
    T0 + 10,
    'ack-with-lost-submission-marker',
  );
  assert.equal(acknowledged.snapshot.projection.submissionObserved, false);
  assert.equal(acknowledged.snapshot.projection.httpAcknowledged, true);
  assert.equal(acknowledged.snapshot.projection.reconciled, false);
  assert.equal(acknowledged.snapshot.projection.recoveryRequired, true);
  assert.ok(buildMutationReconciliationHandoff(acknowledged).reasonCodes.length > 0);
});

test('a previously eligible boundary expires before a later synthetic submission observation', () => {
  const intent = journalAt('INTENT', T0 + 10);
  const decision = evaluateSyntheticSubmissionBoundary(intent, T0 + 9);
  assert.equal(decision.state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  assert.throws(
    () => prepareSyntheticSubmissionObservationAppend(
      intent,
      decision,
      submittedAttempt(intent),
      T0 + 11,
    ),
    TypeError,
  );
});

test('HTTP and private exchange observations cannot attach before durable SUBMISSION_INTENT', () => {
  const preflighted = journalAt('PREFLIGHTED');
  const identityContext = journalAt('INTENT');
  const httpPayload = {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'2'.repeat(64)}`,
  };
  assertObservationNotAcceptedAsCompatible(
    preflighted,
    observationInput(identityContext, 'HTTP_OBSERVED', httpPayload, T0 + 10, 'premature-http'),
  );
  assertObservationNotAcceptedAsCompatible(
    preflighted,
    observationInput(
      identityContext,
      'PRIVATE_ORDER_OBSERVED',
      privateOrderPayload(),
      T0 + 10,
      'premature-private',
    ),
  );
});

test('local receipt time cannot move backwards even when exchange occurrence time is out of order', () => {
  const submitted = journalAt('SUBMITTED');
  const lastReceipt = submitted.snapshot.entries.at(-1).receivedAtMs;
  const payload = privateOrderPayload({ exchangeEventTimeMs: T0 + 1 });
  const input = observationInput(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    payload,
    T0 + 2,
    'receipt-regression',
  );
  input.receivedAtMs = lastReceipt - 1;
  assertObservationNotAcceptedAsCompatible(submitted, input);
});

test('an old exact duplicate stays idempotent after newer observations advance the receipt tail', () => {
  const submitted = journalAt('SUBMITTED');
  const orderPayload = privateOrderPayload({
    cumulative: '0.4',
    exchangeEventTimeMs: T0 + 10,
    revisionCharacter: 'e',
  });
  const original = observationInput(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    orderPayload,
    T0 + 12,
    'delayed-duplicate-order',
  );
  const firstPrepared = prepareMutationObservationAppend(submitted, original);
  assert.equal(firstPrepared.kind, 'PREPARED');
  const first = commit(firstPrepared.prepared);
  const later = appendObservation(first, 'HTTP_OBSERVED', {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'6'.repeat(64)}`,
  }, T0 + 14, 'later-than-duplicate');

  const replay = prepareMutationObservationAppend(later, original);
  assert.equal(replay.kind, 'EXACT_DUPLICATE');
  assert.equal(replay.persisted.snapshot.headDigest, later.snapshot.headDigest);
});

test('telemetry degradation is coalesced per subsystem and cannot consume money-critical capacity', () => {
  const submitted = journalAt('SUBMITTED');
  const first = appendObservation(submitted, 'TELEMETRY_DEGRADED', {
    subsystem: 'TRACE',
    reasonCode: 'TRACE_RECORDING_DEGRADED',
  }, T0 + 12, 'trace-degraded-first');
  assert.equal(first.snapshot.projection.telemetryDegraded, true);

  assertObservationNotAcceptedAsCompatible(
    first,
    observationInput(first, 'TELEMETRY_DEGRADED', {
      subsystem: 'TRACE',
      reasonCode: 'TRACE_RECORDING_STILL_DEGRADED',
    }, T0 + 13, 'trace-degraded-second'),
  );

  const moneyEvidence = appendObservation(first, 'HTTP_OBSERVED', {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'8'.repeat(64)}`,
  }, T0 + 14, 'money-after-telemetry');
  assert.equal(moneyEvidence.snapshot.projection.httpAcknowledged, true);
  assert.equal(moneyEvidence.snapshot.projection.recoveryRequired, true);
});

test('later private cumulative quantity regression becomes a named conflict', () => {
  const submitted = journalAt('SUBMITTED');
  const first = appendObservation(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({ cumulative: '0.6', exchangeEventTimeMs: T0 + 10, revisionCharacter: '6' }),
    T0 + 12,
    'cumulative-0.6',
  );
  const regressed = appendObservation(
    first,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({ cumulative: '0.4', exchangeEventTimeMs: T0 + 11, revisionCharacter: '7' }),
    T0 + 13,
    'cumulative-0.4-later',
  );
  assert.equal(regressed.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(regressed.snapshot.projection.conflictCodes.length > 0);
});

test('distinct trade fills cannot sum beyond requested quantity behind a valid cumulative maximum', () => {
  const submitted = journalAt('SUBMITTED');
  const first = appendObservation(
    submitted,
    'PRIVATE_FILL_OBSERVED',
    privateFillPayload({
      tradeId: '1',
      fill: '0.6',
      cumulative: '0.6',
      exchangeEventTimeMs: T0 + 10,
      revisionCharacter: '8',
    }),
    T0 + 12,
    'trade-1',
  );
  const overfilled = appendObservation(
    first,
    'PRIVATE_FILL_OBSERVED',
    privateFillPayload({
      tradeId: '2',
      fill: '0.6',
      cumulative: '1',
      exchangeEventTimeMs: T0 + 11,
      revisionCharacter: '9',
    }),
    T0 + 13,
    'trade-2',
  );
  assert.equal(overfilled.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(overfilled.snapshot.projection.conflictCodes.length > 0);
});

test('a later working status after terminal evidence is conflict, never silent last-write selection', () => {
  const submitted = journalAt('SUBMITTED');
  const filled = appendObservation(
    submitted,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({
      status: 'FILLED',
      cumulative: '1',
      exchangeEventTimeMs: T0 + 10,
      revisionCharacter: 'a',
    }),
    T0 + 12,
    'filled-terminal',
  );
  const reversed = appendObservation(
    filled,
    'PRIVATE_ORDER_OBSERVED',
    privateOrderPayload({
      status: 'NEW',
      cumulative: '0',
      exchangeEventTimeMs: T0 + 11,
      revisionCharacter: 'b',
    }),
    T0 + 13,
    'new-after-filled',
  );
  assert.equal(reversed.snapshot.projection.lifecycle, 'CONFLICT');
  assert.ok(reversed.snapshot.projection.conflictCodes.length > 0);
});

test('compatible event-before-HTTP and HTTP-before-event histories share one semantic outcome revision', () => {
  const leftBase = journalAt('SUBMITTED');
  const rightBase = journalAt('SUBMITTED');
  const http = {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'3'.repeat(64)}`,
  };
  const order = privateOrderPayload({
    cumulative: '0.5',
    exchangeEventTimeMs: T0 + 10,
    revisionCharacter: 'd',
  });

  const leftHttp = appendObservation(leftBase, 'HTTP_OBSERVED', http, T0 + 14, 'permutation-http');
  const left = appendObservation(leftHttp, 'PRIVATE_ORDER_OBSERVED', order, T0 + 14, 'permutation-order');
  const rightOrder = appendObservation(rightBase, 'PRIVATE_ORDER_OBSERVED', order, T0 + 14, 'permutation-order');
  const right = appendObservation(rightOrder, 'HTTP_OBSERVED', http, T0 + 14, 'permutation-http');

  assert.deepEqual(left.snapshot.projection, right.snapshot.projection);
  assert.equal(left.snapshot.outcomeRevision, right.snapshot.outcomeRevision);
  assert.notEqual(left.snapshot.headDigest, right.snapshot.headDigest);
});

test('HTTP acknowledgement preserves separate working, fill, terminal and reconciliation axes', () => {
  const submitted = journalAt('SUBMITTED');
  const acknowledged = appendObservation(submitted, 'HTTP_OBSERVED', {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: `sha256:${'4'.repeat(64)}`,
  }, T0 + 12, 'ack-axis');
  assert.equal(acknowledged.snapshot.projection.httpAcknowledged, true);
  assert.equal(acknowledged.snapshot.projection.cumulativeFilledQuantity, '0');
  assert.equal(acknowledged.snapshot.projection.workingStatus, null);
  assert.equal(acknowledged.snapshot.projection.terminalStatus, null);
  assert.equal(acknowledged.snapshot.projection.reconciled, false);
});

test('cancel-replace partial HTTP evidence cannot alias onto a PLACE_ORDER identity', () => {
  const submitted = journalAt('SUBMITTED');
  const payload = {
    classification: 'PARTIAL_MIXED',
    httpStatus: 409,
    ambiguityCause: 'CANCEL_REPLACE_PARTIAL',
    venueOrderId: null,
    responseContentRevision: `sha256:${'5'.repeat(64)}`,
  };
  assertObservationNotAcceptedAsCompatible(
    submitted,
    {
      observationId: `l06obs_${'0'.repeat(64)}`,
      kind: 'HTTP_OBSERVED',
      occurredAtMs: T0 + 12,
      receivedAtMs: T0 + 12,
      sourceRevision: 'l06-invalid-partial-mixed-source',
      payload: {
        l03RequestAttempt: httpAttempt(submitted, payload),
        partialMixed: true,
        venueOrderId: null,
        responseContentRevision: payload.responseContentRevision,
      },
    },
  );
});

test('sanitized HTTP response evidence requires an exact content hash', () => {
  const submitted = journalAt('SUBMITTED');
  const payload = {
    classification: 'ACKNOWLEDGED',
    httpStatus: 200,
    ambiguityCause: null,
    venueOrderId: '42',
    responseContentRevision: 'caller-label-is-not-a-content-hash',
  };
  assert.throws(
    () => prepareMutationObservationAppend(
      submitted,
      observationInput(submitted, 'HTTP_OBSERVED', payload, T0 + 12, 'non-hash-response'),
    ),
    TypeError,
  );
});

test('even a complete capital evidence ladder cannot raise the unchanged 10-USDT ceiling', () => {
  const submitted = journalAt('SUBMITTED');
  const dimensions = CAPITAL_EVIDENCE_DIMENSIONS.map((dimension, index) => ({
    dimension,
    state: 'PROVEN',
    evidenceRevision: `owner-evidence-revision:${String(index).padStart(2, '0')}`,
  }));
  const candidate = buildCapitalEvidenceCandidate(submitted, dimensions);
  assert.equal(candidate.state, 'OWNER_REVIEW_REQUIRED');
  assert.equal(candidate.currentCanaryMaximumNotional, '10');
  assert.equal(candidate.recommendedMaximumNotional, '10');
  assert.equal(candidate.notionalUnit, 'USDT');
  assert.equal(candidate.boundPreflightResultNotional, '9.5');
  assert.ok(candidate.reasonCodes.includes('OWNER_AUTHORIZATION_REQUIRED'));
  assert.ok(candidate.reasonCodes.includes('ROLLBACK_DEMOTION_REQUIRED'));
  assert.equal(candidate.explicitOwnerAuthorizationPresent, false);
  assert.equal(candidate.automaticPromotion, false);
  assert.equal(candidate.capitalAuthority, 'NONE');
  assert.equal(candidate.riskAuthority, 'NONE');
  assert.equal(candidate.externalActionAuthorization, 'NONE');
});

test('complete latency evidence cannot fabricate journal milestones that were not observed', () => {
  const submitted = journalAt('SUBMITTED');
  assert.throws(() => buildFullChainLatencyEvidence(submitted, {
    exchangeEventAtMs: T0 + 100,
    localReceiveAtMs: T0 + 101,
    featuresReadyAtMs: T0 + 102,
    decisionAtMs: T0 + 103,
    approvalAtMs: T0 + 104,
    durableIntentAtMs: T0 + 105,
    syntheticSubmissionAtMs: T0 + 106,
    acknowledgementAtMs: T0 + 107,
    privateConfirmationAtMs: T0 + 108,
    exchangeClockCalibration: 'UTC_CALIBRATED',
    exchangeClockCalibrationRevision: 'l03-clock-calibration:fixture-0001',
    recording: {
      state: 'RUNNING',
      observedAtMs: T0 + 109,
      gapCount: 0,
      quotaState: 'OK',
      storagePressure: 'OK',
    },
    observedAtMs: T0 + 109,
  }), TypeError);
});
