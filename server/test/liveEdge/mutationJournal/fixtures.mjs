import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { canonicalJson, deriveClientOrderId } from '../../../dist/foundation/contracts/index.js';
import { deriveTransportRequestId } from '../../../dist/liveEdge/adapters/binanceSignedKernel/identity.js';
import {
  createRequestAttempt,
  reduceRequestAttempt,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';
import { createSpotRealmBoundRevision } from '../../../dist/liveEdge/adapters/binancePrivateTruth/spotLifecycle.js';
import {
  createUsdmRealmBoundRevision,
  mapUsdmPrivateEventSemantics,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/usdmLifecycle.js';
import {
  buildFoundationReconciliationObservation,
  confirmMutationAppend,
  mutationObservationId,
  prepareInitialMutationAppend,
  preparePreflightMutationAppend,
  prepareSubmissionIntentAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import { buildL05SpotOwnerEvidence } from './l05-owner-fixture.mjs';

export const T0 = 2_000_000_000_000;
export const HEX64 = 'a'.repeat(64);

export function inputFixture(overrides = {}) {
  const requestedQuantity = overrides.requestedQuantity ?? '1';
  const ticketId = overrides.identity?.ticketId ?? `plan_${'1'.repeat(16)}`;
  const legId = overrides.identity?.legId ?? `leg_${'2'.repeat(16)}`;
  const attempt = overrides.identity?.attempt ?? 0;
  const globalCorrelationId = overrides.identity?.globalCorrelationId ?? `cor_${'3'.repeat(16)}`;
  const product = overrides.identity?.product ?? 'SPOT';
  const contractId = overrides.identity?.contractId ?? 'SPOT_ORDER_POST';
  const requestSequence = overrides.identity?.requestSequence ?? 0;
  const intentFingerprint = overrides.identity?.intentFingerprint ?? '8'.repeat(32);
  const requestProduct = product === 'USD_M_PERPETUAL' ? 'USD_M_PERPETUAL' : 'SPOT';
  const signerProfile = overrides.identity?.signerProfile
    ?? (requestProduct === 'SPOT' ? 'SPOT_HMAC_SHA256' : 'USDM_HMAC_SHA256');
  const requestId = overrides.identity?.requestId ?? deriveTransportRequestId({
    contractId,
    product: requestProduct,
    environment: 'PRODUCTION',
    signerProfile,
    correlationId: globalCorrelationId,
    requestSequence,
    intentFingerprint,
  }).requestId;
  const identity = {
    globalCorrelationId,
    assessmentId: 'assessment:edge-1',
    decisionId: `cdec_${'4'.repeat(16)}`,
    strategyId: 'BASIS',
    proposalId: `cprop_${'5'.repeat(16)}`,
    capitalMandateId: `cmdt_${'6'.repeat(32)}`,
    capitalReservationId: `cres_${'7'.repeat(32)}`,
    ticketId,
    legId,
    requestId,
    requestSequence,
    intentFingerprint,
    signerProfile,
    clientOrderId: deriveClientOrderId({ planId: ticketId, legId, attempt }),
    attempt,
    product,
    environment: 'PRODUCTION',
    accountRealmId: 'account-realm:primary',
    symbol: 'BTCUSDT',
    mutationKind: 'PLACE_ORDER',
    contractId,
    contractState: 'CURRENT',
    ...overrides.identity,
  };
  const preflightResult = {
    schema: 'BINANCE_STATIC_FILTER_PREFLIGHT_V1',
    staticState: 'PASS',
    reasonCodes: [],
    instrumentRevision: `l04-instrument-spec:${'9'.repeat(24)}`,
    sourceEvidenceRevision: `l04-instrument-source-evidence:${'a'.repeat(24)}`,
    registryRevision: `l04-instrument-registry:${'0'.repeat(24)}`,
    snapshotRevision: `l04-instrument-registry-snapshot:${'b'.repeat(24)}`,
    referenceEvidenceRevision: null,
    evaluatedAtMs: T0 - 100,
    instrumentValidUntilMs: T0 + 10_000,
    referenceObservedAtMs: null,
    referenceValidUntilMs: null,
    notionalAsset: 'USDT',
    requestedPrice: '9.5',
    validationPrice: '9.5',
    requestedQuantity,
    resultQuantity: requestedQuantity,
    resultNotional: '9.5',
    effectiveNotionalCeiling: '10',
    transformations: [],
    externalRequirements: [],
    canaryMaximumNotional: '10',
    sendEligible: false,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    ...overrides.preflightResult,
  };
  const preflightContentRevision = `l06l04binding_${createHash('sha256')
    .update(canonicalJson(preflightResult)).digest('hex')}`;
  const bindings = {
    instrumentRevision: preflightResult.instrumentRevision,
    sourceEvidenceRevision: preflightResult.sourceEvidenceRevision,
    registryRevision: preflightResult.registryRevision,
    snapshotRevision: preflightResult.snapshotRevision,
    referenceEvidenceRevision: preflightResult.referenceEvidenceRevision,
    preflightContentRevision,
    preflightResultQuantity: requestedQuantity,
    preflightResultNotional: '9.5',
    preflightNotionalAsset: 'USDT',
    preflightCanaryMaximumNotional: '10',
    sanitizedRequestContentHash: `sha256:${'d'.repeat(64)}`,
    privateProjectionRevision: `l05proj_${'e'.repeat(64)}`,
    privateSourceCutRevision: `l05pcut_${'f'.repeat(64)}`,
    lifecycleRevisions: [`l05lifecycle_${'1'.repeat(64)}`],
    foundationReconciliationResultRevision: `foundation-reconciliation-result:${'2'.repeat(24)}`,
    capitalMandateRevision: `capital-mandate-revision:${'3'.repeat(24)}`,
    riskVerdictRevision: `foundation-risk-verdict:${'4'.repeat(24)}`,
    regimeAdvisoryRevision: null,
    regimePostureState: 'UNKNOWN',
    sourceExchangeEventAtMs: T0 - 400,
    sourceLocalReceiveAtMs: T0 - 390,
    featuresReadyAtMs: T0 - 300,
    decisionAtMs: T0 - 250,
    approvalAtMs: T0 - 150,
    timingEvidenceRevision: `timing-evidence:${'5'.repeat(24)}`,
    exchangeClockCalibrationRevision: `l03-clock-calibration:${'6'.repeat(24)}`,
    preflightEvaluatedAtMs: T0 - 100,
    privateEvaluatedAtMs: T0 - 50,
    validUntilMs: T0 + 10_000,
    preflightState: 'CURRENT_NON_SENDABLE',
    ...overrides.bindings,
  };
  return {
    identity,
    bindings,
    preflightResult,
    requestedQuantity,
    createdAtMs: overrides.createdAtMs ?? T0,
  };
}

export function acknowledgement(prepared, options = {}) {
  const request = prepared.request;
  const disposition = options.disposition ?? 'COMMITTED_NEW';
  const committed = disposition === 'COMMITTED_NEW' || disposition === 'IDEMPOTENT_REPLAY';
  return {
    schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1',
    version: 1,
    owner: 'SYSTEM_INTEGRATION_LEDGER',
    disposition,
    mutationId: request.mutationId,
    entryId: request.entryId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    expectedJournalVersion: request.expectedJournalVersion,
    committedJournalVersion: committed ? request.nextJournalVersion : null,
    previousHeadDigest: request.previousHeadDigest,
    committedHeadDigest: committed ? request.nextHeadDigest : null,
    committedOutcomeRevision: committed ? request.nextOutcomeRevision : null,
    appendedCount: disposition === 'COMMITTED_NEW' ? 1 : 0,
    ledgerEventId: committed ? (options.ledgerEventId ?? request.nextJournalVersion) : null,
    committedAtMs: committed
      ? (options.committedAtMs ?? prepared.nextSnapshot.entries.at(-1).receivedAtMs + 1)
      : null,
    failureCode: committed ? null : (options.failureCode ?? 'PERSISTENCE_WRITE_FAILED'),
    externalActionAuthorization: 'NONE',
    ...options.override,
  };
}

export function persist(prepared, options = {}) {
  const result = confirmMutationAppend(prepared, acknowledgement(prepared, options));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.persisted;
}

export function initialPersisted(input = inputFixture(), options = {}) {
  return persist(prepareInitialMutationAppend(input), options);
}

export function preflightPersisted(input = inputFixture()) {
  const created = initialPersisted(input);
  return persist(preparePreflightMutationAppend(created, T0 + 1));
}

export function submittingPersisted(input = inputFixture(), options = {}) {
  const preflight = preflightPersisted(input);
  return persist(prepareSubmissionIntentAppend(preflight, T0 + 2), options);
}

export function l03SubmittedAttempt(current) {
  const created = createRequestAttempt({
    requestId: current.snapshot.identity.requestId,
    clientOrderId: current.snapshot.identity.clientOrderId,
  });
  const submitted = reduceRequestAttempt(created, { kind: 'SUBMIT' });
  assert.equal(submitted.applied, true);
  return submitted.state;
}

export function l03HttpAttempt(current, {
  classification = 'ACKNOWLEDGED',
  httpStatus = 200,
  ambiguityCause = null,
} = {}) {
  const submitted = l03SubmittedAttempt(current);
  let outcome = 'SUCCESS';
  let disconnected = false;
  if (classification === 'REJECTED_RESPONSE' || classification === 'PARTIAL_MIXED') outcome = 'REJECTED';
  if (classification === 'AMBIGUOUS') {
    if (ambiguityCause === 'TRANSPORT_TIMEOUT') outcome = 'TIMEOUT';
    else if (ambiguityCause === 'TRANSPORT_DISCONNECTED') {
      outcome = 'AMBIGUOUS';
      disconnected = true;
    } else if (ambiguityCause === 'TRANSPORT_ABORTED_AFTER_DISPATCH') outcome = 'ABORTED';
    else if (ambiguityCause === 'MALFORMED_RESPONSE_AFTER_DISPATCH') outcome = 'MALFORMED';
    else if (ambiguityCause === 'INCOMPLETE_SUCCESS_RESPONSE') outcome = 'SUCCESS';
    else outcome = 'AMBIGUOUS';
  }
  const observed = reduceRequestAttempt(submitted, {
    kind: 'TRANSPORT_OBSERVED',
    outcome,
    httpStatus,
    disconnected,
  });
  assert.equal(observed.applied, true, JSON.stringify({ classification, httpStatus, ambiguityCause }));
  return observed.state;
}

export function l03AttemptContentRevision(attempt) {
  return `l06l03binding_${createHash('sha256')
    .update(canonicalJson(attempt)).digest('hex')}`;
}

export function privateLineage(current, label, {
  observationKind = 'ORDER',
  exchangeEventTimeMs = T0 + 5,
  receiptTimeMs = exchangeEventTimeMs + 2,
  generation = 1,
  fact = null,
} = {}) {
  assert.ok(fact && typeof fact === 'object', `private fact projection required: ${label}`);
  const content = createHash('sha256').update(canonicalJson({
    schema: observationKind === 'FILL'
      ? 'L06_PRIVATE_FILL_FACT_PROJECTION_V1'
      : 'L06_PRIVATE_ORDER_FACT_PROJECTION_V1',
    product: current.snapshot.identity.product,
    accountRealmId: current.snapshot.identity.accountRealmId,
    symbol: current.snapshot.identity.symbol,
    clientOrderId: current.snapshot.identity.clientOrderId,
    ...fact,
  })).digest('hex').slice(0, 32);
  const privateContentRevision = `${current.snapshot.identity.product === 'SPOT' ? 'spot' : 'usdm'}_content_${content}`;
  const common = {
    privateLifecycleRevision: current.snapshot.bindings.lifecycleRevisions[0],
    privateContentRevision,
    privateReceiptTimeMs: receiptTimeMs,
  };
  if (current.snapshot.identity.product === 'SPOT') {
    const privateEventKind = observationKind === 'FILL' ? 'FILL' : 'ORDER';
    return {
      ...common,
      privateEventKind,
      privateEventRevision: createSpotRealmBoundRevision(
        'spot_event',
        current.snapshot.identity.accountRealmId,
        {
          generation,
          eventKind: privateEventKind,
          contentRevision: privateContentRevision,
          exchangeEventTimeMs,
          receiptTimeMs,
        },
      ),
      privateTransactionTimeMs: null,
      privateSemanticCategory: null,
      privateOrderExecutionType: null,
      privateIsFill: null,
    };
  }
  const privateEventKind = 'ORDER_TRADE_UPDATE';
  const privateOrderExecutionType = observationKind === 'FILL' ? 'TRADE' : 'NEW';
  const semantics = mapUsdmPrivateEventSemantics(privateEventKind, privateOrderExecutionType);
  assert.ok(semantics);
  return {
    ...common,
    privateEventKind,
    privateEventRevision: createUsdmRealmBoundRevision(
      'usdm_event',
      current.snapshot.identity.accountRealmId,
      {
        generation,
        eventKind: privateEventKind,
        contentRevision: privateContentRevision,
        exchangeEventTimeMs,
        transactionTimeMs: exchangeEventTimeMs,
        semanticCategory: semantics.semanticCategory,
        orderExecutionType: semantics.orderExecutionType,
        isFill: semantics.isFill,
        receiptTimeMs,
      },
    ),
    privateTransactionTimeMs: exchangeEventTimeMs,
    privateSemanticCategory: semantics.semanticCategory,
    privateOrderExecutionType: semantics.orderExecutionType,
    privateIsFill: semantics.isFill,
  };
}

export function foundationReconciliationObservation(current, options = {}) {
  const status = options.status ?? 'EXACT';
  const requested = Number(current.snapshot.requestedQuantity);
  const exactQuantity = options.cumulativeFilledQuantity === undefined
    ? current.snapshot.projection.cumulativeFilledQuantity
    : options.cumulativeFilledQuantity;
  const quantity = exactQuantity === null ? null : Number(exactQuantity);
  const requestedEffect = options.effect ?? 'FILLED';
  const observedOrderStatus = options.observedOrderStatus === undefined
    ? requestedEffect === 'FILLED' ? 'FILLED'
      : requestedEffect === 'CANCELED' ? 'CANCELED'
        : requestedEffect === 'EXPIRED' ? 'EXPIRED'
          : requestedEffect === 'REJECTED_NO_EFFECT_PROVEN' ? 'REJECTED'
            : requestedEffect === 'NEW' ? 'NEW'
              : requestedEffect === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED'
                : requestedEffect === 'ACKNOWLEDGED' ? null
                  : 'UNKNOWN'
    : options.observedOrderStatus;
  const expectedLifecycle = options.expectedLifecycle
    ?? (requestedEffect === 'FILLED' ? 'FILLED'
      : requestedEffect === 'CANCELED' || requestedEffect === 'EXPIRED' ? 'CANCELLED'
        : requestedEffect === 'REJECTED_NO_EFFECT_PROVEN' ? 'REJECTED'
          : requestedEffect === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED'
            : requestedEffect === 'NEW' || requestedEffect === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED'
              : 'AMBIGUOUS');
  const resultRevision = options.resultRevision
    ?? `foundation-reconciliation-result:${createHash('sha256')
      .update(`result:${requestedEffect}:${status}:${options.label ?? 'default'}`)
      .digest('hex').slice(0, 24)}`;
  const observedAtMs = options.observedAtMs ?? T0 + 30;
  const venueOrderId = options.venueOrderId === undefined
    ? current.snapshot.projection.venueOrderId ?? (['FILLED', 'CANCELED', 'EXPIRED'].includes(requestedEffect) ? '1001' : null)
    : options.venueOrderId;
  const legStatus = options.legStatus ?? status;
  const otherClientOrderId = (legId) => deriveClientOrderId({
    planId: current.snapshot.identity.ticketId,
    legId,
    attempt: current.snapshot.identity.attempt,
  });
  const matchingLegKey = current.snapshot.identity.product === 'SPOT' ? 'SPOT' : 'PERP';
  const matchingLeg = {
    phase: 'OPEN',
    legKey: matchingLegKey,
    clientOrderId: current.snapshot.identity.clientOrderId,
    venueOrderId,
    expectedLifecycle,
    expectedSubmittedQuantity: requested,
    expectedFilledQuantity: quantity ?? 0,
    observedOrderStatus,
    observedOrderFilledQuantity: quantity,
    observedTradeFilledQuantity: quantity,
    observedFilledQuantity: quantity,
    observedRemainderQuantity: quantity === null ? null : Math.max(0, requested - quantity),
    status: legStatus,
    reasonCodes: [],
  };
  const neutralLeg = (phase, legKey, legId) => ({
    phase,
    legKey,
    clientOrderId: otherClientOrderId(legId),
    venueOrderId: null,
    expectedLifecycle: 'PLANNED',
    expectedSubmittedQuantity: 0,
    expectedFilledQuantity: 0,
    observedOrderStatus: null,
    observedOrderFilledQuantity: 0,
    observedTradeFilledQuantity: 0,
    observedFilledQuantity: 0,
    observedRemainderQuantity: 0,
    status: 'EXACT',
    reasonCodes: [],
  });
  const legs = [
    matchingLegKey === 'SPOT'
      ? matchingLeg
      : neutralLeg('OPEN', 'SPOT', `leg_${'a'.repeat(16)}`),
    matchingLegKey === 'PERP'
      ? matchingLeg
      : neutralLeg('OPEN', 'PERP', `leg_${'b'.repeat(16)}`),
    neutralLeg('CLOSE', 'SPOT', `leg_${'c'.repeat(16)}`),
    neutralLeg('CLOSE', 'PERP', `leg_${'d'.repeat(16)}`),
  ];
  const exactSource = (sourceId, historyRequired) => ({
    sourceId,
    sourceTimeMs: observedAtMs - 1,
    receivedAtMs: observedAtMs - 1,
    maxAgeMs: 1_000,
    freshness: 'FRESH',
    authority: 'LIVE_PRIVATE',
    completeness: 'COMPLETE',
    coverageStartMs: historyRequired ? observedAtMs - 1_000 : null,
    coverageEndMs: historyRequired ? observedAtMs - 1 : null,
    status: 'EXACT',
    reasonCodes: [],
  });
  const result = {
    planId: current.snapshot.identity.ticketId,
    correlationId: current.snapshot.identity.globalCorrelationId,
    evaluatedAtMs: observedAtMs,
    status,
    recommendation: status === 'EXACT' ? 'NO_ACTION' : status === 'PENDING' ? 'WAIT'
      : status === 'PARTIAL' || status === 'STALE' ? 'REFRESH' : 'MANUAL_REVIEW',
    executionAuthority: 'NONE',
    reasons: [],
    legs,
    positions: [
      {
        venue: 'BINANCE_SPOT', expectedDeltaQuantity: 0, observedDeltaQuantity: 0,
        differenceQuantity: 0, status: 'EXACT', reasonCodes: [],
      },
      {
        venue: 'BINANCE_USDM', expectedDeltaQuantity: 0, observedDeltaQuantity: 0,
        differenceQuantity: 0, status: 'EXACT', reasonCodes: [],
      },
    ],
    sources: {
      orders: exactSource('foundation-owner-orders', true),
      fills: exactSource('foundation-owner-fills', true),
      positions: exactSource('foundation-owner-positions', false),
    },
    normalization: {
      exactDuplicateOrdersDropped: 0,
      exactDuplicateFillsDropped: 0,
      exactDuplicatePositionsDropped: 0,
      outOfOrderFillPairs: 0,
    },
  };
  if (current.snapshot.identity.product !== 'SPOT') {
    throw new TypeError('L06 canonical reconciliation fixture currently proves Spot owner evidence only');
  }
  const ownerEvidence = buildL05SpotOwnerEvidence({
    accountRealmId: current.snapshot.identity.accountRealmId,
    targetSymbol: current.snapshot.identity.symbol,
    evaluatedAtMs: observedAtMs,
    resultRevision,
  });
  return buildFoundationReconciliationObservation(current, {
    resultRevision,
    result,
    privateProjection: ownerEvidence.projection,
    privateLifecycleWitness: ownerEvidence.witness,
    receivedAtMs: options.receivedAtMs ?? observedAtMs + 1,
  });
}

export function observationId(current, input) {
  return mutationObservationId(current, input);
}
