import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  generateM0AutomaticReceipt,
  M0_AUTOMATIC_RECEIPT_SCHEMA,
} from '../../../dist/systemIntegration/evidence/m0AutomaticReceipt.js';
import {
  createSpotExecutionTicket,
} from '../../../dist/foundation/execution/spotTicket.js';
import {
  calculatePreviewDigest,
  durableActionDigest,
  operatorActorBinding,
} from '../../../dist/liveEdge/controls/index.js';

const NOW = 1_900_000_000_000;
const MAX_AGE_MS = 60_000;
const SOURCE_COMMIT_SHA = 'a169b123fb186d1943a75ad648552c4d95be1be1';
const INPUT_SCHEMA = 'cosmos.system-integration.m0-automatic-receipt-input.v1';
const BINDING_SCHEMA = 'cosmos.system-integration.m0-receipt-binding.v1';
const VALIDATION_SCHEMA = 'cosmos.system-integration.m0-validation-fact.v1';
const TERMINAL_COVERAGE_SCHEMA = 'cosmos.system-integration.m0-terminal-coverage.v1';
const LIFECYCLE_EVIDENCE_SCHEMA =
  'cosmos.system-integration.m0-lifecycle-evidence.v1';
const POST_FLAT_SCHEMA = 'cosmos.system-integration.m0-post-flat.v1';
const RECONCILIATION_SCHEMA = 'cosmos.system-integration.m0-reconciliation-fact.v1';
const POST_DISARM_SCHEMA = 'cosmos.system-integration.m0-post-disarm.v1';
const CONSUMED_AUTHORITY_SCHEMA =
  'cosmos.system-integration.m0-consumed-authority.v1';
const FINANCIAL_SCHEMA = 'cosmos.system-integration.m0-financial-fact.v1';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function clone(value) {
  return structuredClone(value);
}

function ticket() {
  return createSpotExecutionTicket({
    correlationId: 'm0-canary-correlation',
    planId: 'm0-canary-plan',
    accountId: 'm0-canary-account',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.0001',
    price: '100000',
    riskReferencePrice: '100000',
    estimatedMaxLossQuote: '0.1',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW - 50_000,
    expiresAtMs: NOW + 50_000,
  });
}

function ownerRef(owner, id) {
  const revision = `${id}.revision.v1`;
  return {
    schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1',
    owner,
    id,
    revision,
    digest: `sha256:${sha256(`${owner}|${id}|${revision}`)}`,
  };
}

function boundFact(binding, authority, ownerRevision, extra) {
  return {
    version: 1,
    binding: clone(binding),
    authority,
    ownerRevision,
    observedAtMs: NOW - 1_000,
    validUntilMs: NOW + 20_000,
    ...extra,
  };
}

function lifecycleEvents(currentTicket, { filled = '0.0001', flattened = filled } = {}) {
  return [
    {
      type: 'PREPARED',
      eventId: 'm0-event-1',
      sequence: 1,
      originalClientOrderId: currentTicket.clientOrderId,
      targetQuantity: currentTicket.quantity,
    },
    { type: 'SUBMIT_STARTED', eventId: 'm0-event-2', sequence: 2 },
    {
      type: 'ORDER_ACKNOWLEDGED',
      eventId: 'm0-event-3',
      sequence: 3,
      venueOrderId: 'm0-venue-order-1',
      cumulativeFilledQuantity: '0',
    },
    {
      type: 'FILL_OBSERVED',
      eventId: 'm0-event-4',
      sequence: 4,
      venueOrderId: 'm0-venue-order-1',
      cumulativeFilledQuantity: filled,
    },
    {
      type: 'FLATTEN_REQUIRED',
      eventId: 'm0-event-5',
      sequence: 5,
      sourceOrderTerminal: true,
    },
    { type: 'FLATTEN_STARTED', eventId: 'm0-event-6', sequence: 6 },
    {
      type: 'FLATTEN_FILL_OBSERVED',
      eventId: 'm0-event-7',
      sequence: 7,
      cumulativeFlattenedQuantity: flattened,
    },
  ];
}

function inputFixture(evidenceAuthority = 'LIVE_PRIVATE') {
  const currentTicket = ticket();
  const flattenClientOrderId = 'm0_flatten_0001';
  const sourceVenueOrderId = 'm0-venue-order-1';
  const flattenVenueOrderId = 'm0-flatten-venue-order-1';
  const events = lifecycleEvents(currentTicket);
  const lifecycleReplayDigest = `sha256:${sha256(canonicalJson(events))}`;
  const privateSourceCutRevision = `l05pcut_${sha256('m0-private-source-cut')}`;
  const privateProjectionRevision =
    `l05proj_${sha256('m0-private-projection')}`;
  const reconciliationResultRevision =
    `foundation-reconciliation-result:${sha256('m0-reconciliation-result')}`;
  const binding = {
    schema: BINDING_SCHEMA,
    version: 1,
    ticketId: currentTicket.ticketId,
    termsDigest: currentTicket.termsDigest,
    clientOrderId: currentTicket.clientOrderId,
    flattenClientOrderId,
    correlationId: currentTicket.correlationId,
    accountId: currentTicket.accountId,
    symbol: currentTicket.symbol,
    lifecycleReplayDigest,
    sourceVenueOrderId,
    flattenVenueOrderId,
    privateSourceCutRevision,
    privateProjectionRevision,
    reconciliationResultRevision,
  };
  const arm = ownerRef('CAPITAL_APPROVALS', 'm0-arm-1');
  const action = {
    type: 'DISARM',
    arm,
    cause: 'SAFETY',
  };
  const actorBinding = operatorActorBinding({
    authenticated: true,
    subjectId: 'm0-test-operator',
    sessionId: 'm0-test-session',
    source: 'LOOPBACK',
    audience: 'L14_DURABLE_CONTROLS',
    authenticatedAtMs: NOW - 5_000,
    expiresAtMs: NOW + 10_000,
  });
  const unsignedPreview = {
    schema: 'LIVE_EDGE_CONTROL_PREVIEW_V1',
    version: 1,
    commandId: `cmd_${sha256('m0-disarm-command-1').slice(0, 32)}`,
    action,
    actionDigest: durableActionDigest(action),
    expectedConfigVersion: 7,
    expectedControlRevision: 11,
    actorBinding,
    reason: 'M0 canary completed; return to safe posture.',
    generatedAtMs: NOW - 2_000,
    expiresAtMs: NOW + 10_000,
    riskWitness: null,
    externalActionAuthorization: 'NONE',
  };
  const previewDigest = calculatePreviewDigest(unsignedPreview);
  const preview = {
    ...unsignedPreview,
    previewDigest,
  };
  const receipt = {
    schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1',
    version: 1,
    commandId: preview.commandId,
    previewDigest: preview.previewDigest,
    actionType: 'DISARM',
    disposition: 'APPLIED',
    reasonCode: 'CONTROL_APPLIED',
    actorBinding: preview.actorBinding,
    expectedConfigVersion: preview.expectedConfigVersion,
    committedControlRevision: preview.expectedControlRevision + 1,
    applied: true,
    recordedAtMs: NOW - 500,
    ledgerEventIds: [101, 102],
    recoveryStateChanged: false,
    externalActionAuthorization: 'NONE',
  };
  const consumedAuthority = (phase, authorizationId, ownerRevision) => {
    const entry = phase === 'ENTRY';
    return {
      schema: CONSUMED_AUTHORITY_SCHEMA,
      version: 1,
      binding: clone(binding),
      authority: 'CAPITAL_APPROVALS',
      ownerRevision,
      phase,
      authorizationId,
      verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY',
      singleUse: true,
      consumed: true,
      consumptionCount: 1,
      consumedNotionalQuote: currentTicket.orderNotionalQuote,
      maxOrderNotionalQuote: '10',
      confirmedAtMs: NOW - (entry ? 4_500 : 3_500),
      expiresAtMs: NOW + 5_000,
      consumedAtMs: NOW - (entry ? 4_000 : 3_000),
    };
  };

  return {
    schema: INPUT_SCHEMA,
    version: 1,
    sourceCommitSha: SOURCE_COMMIT_SHA,
    evaluatedAtMs: NOW,
    maxEvidenceAgeMs: MAX_AGE_MS,
    evidenceAuthority,
    ticket: clone(currentTicket),
    flattenClientOrderId,
    validation: boundFact(
      binding,
      'FOUNDATION_EXECUTION',
      'validation-owner-revision-1',
      {
        schema: VALIDATION_SCHEMA,
        observedAtMs: NOW - 5_000,
        mode: 'VALIDATE_ONLY',
        localValidationPassed: true,
        blockingCodes: [],
        signedTestPerformed: false,
        liveSendAuthorized: false,
        sendsPerformed: 0,
        sideEffectsPerformed: 0,
        externalActionAuthorization: 'NONE',
        permittedExternalActions: [],
        filterEvidenceRevision: 'filter-evidence-revision-1',
        venueEvidenceRevision: 'venue-evidence-revision-1',
        riskEvidenceRevision: 'policy-evidence-revision-1',
        quoteAsset: 'USDT',
      },
    ),
    lifecycle: {
      schema: LIFECYCLE_EVIDENCE_SCHEMA,
      version: 1,
      events,
      terminalCoverage: boundFact(
        binding,
        'FOUNDATION_EXECUTION',
        'terminal-owner-revision-1',
        {
          schema: TERMINAL_COVERAGE_SCHEMA,
          coveredThroughSequence: 7,
          sourceOrderTerminal: true,
          flattenOrderTerminal: true,
          sourceFillsComplete: true,
          flattenFillsComplete: true,
          lifecycleReplayDigest,
          sourceVenueOrderId,
          flattenVenueOrderId,
        },
      ),
      postFlat: boundFact(
        binding,
        'L05_PRIVATE_TRUTH',
        privateProjectionRevision,
        {
          schema: POST_FLAT_SCHEMA,
          scope: 'ACCOUNT_WIDE',
          status: 'CURRENT_COMPLETE',
          openOrderCount: 0,
          openOrdersComplete: true,
          ordersComplete: true,
          tradesComplete: true,
          accountSnapshotComplete: true,
          privateSourceCutRevision,
          lifecycleReplayDigest,
        },
      ),
    },
    reconciliation: boundFact(
      binding,
      'FOUNDATION_RECONCILIATION',
      reconciliationResultRevision,
      {
        schema: RECONCILIATION_SCHEMA,
        canonicalStatus: 'EXACT',
        ledgerState: 'MATCHED',
        coverage: 'ACCOUNT_WIDE_COMPLETE',
        sourceOrderCovered: true,
        flattenOrderCovered: true,
        fillsCovered: true,
        feesCovered: true,
        residualBaseQuantity: '0',
        accountDeltaExact: true,
        privateSourceCutRevision,
        lifecycleReplayDigest,
        terminalCoverageRevision: 'terminal-owner-revision-1',
        postFlatRevision: privateProjectionRevision,
      },
    ),
    disarm: {
      preview,
      receipt,
      postDisarm: boundFact(
        binding,
        'CAPITAL_APPROVALS',
        'post-disarm-owner-revision-1',
        {
          schema: POST_DISARM_SCHEMA,
          armId: arm.id,
          armRevision: arm.revision,
          armDigest: arm.digest,
          controlRevision: receipt.committedControlRevision,
          status: 'DISARMED_SAFE',
          armed: false,
          newRiskBlocked: true,
          liveSendAuthorized: false,
          observedAtMs: NOW - 250,
        },
      ),
    },
    entryAuthority: consumedAuthority(
      'ENTRY',
      'm0-entry-authorization-1',
      'entry-authority-owner-revision-1',
    ),
    flattenAuthority: consumedAuthority(
      'FLATTEN',
      'm0-flatten-authorization-1',
      'flatten-authority-owner-revision-1',
    ),
    financials: boundFact(
      binding,
      'CAPITAL_FOUNDATION',
      'financial-owner-revision-1',
      {
        schema: FINANCIAL_SCHEMA,
        quoteAsset: 'USDT',
        cashCommittedQuote: '10',
        orderNotionalQuote: currentTicket.orderNotionalQuote,
        flattenNotionalQuote: currentTicket.orderNotionalQuote,
        grossExposureQuote: currentTicket.orderNotionalQuote,
        fees: [
          {
            asset: 'USDT',
            quantity: '0.01',
            quoteEquivalent: '0.01',
          },
        ],
        feesQuote: '0.01',
        feeCoverageComplete: true,
        maximumLossQuote: currentTicket.estimatedMaxLossQuote,
      },
    ),
  };
}

export { inputFixture };

function assertNeverLive(result) {
  assert.equal(
    ['NOT_PROVED', 'VALIDATION_PROVED'].includes(result.milestoneClaim),
    true,
  );
}

function assertNotProved(value, axisName = null, reasonCode = null) {
  const result = generateM0AutomaticReceipt(value);
  assert.equal(result.schema, M0_AUTOMATIC_RECEIPT_SCHEMA);
  assert.equal(result.disposition, 'NOT_PROVED');
  assert.equal(result.milestoneClaim, 'NOT_PROVED');
  assertNeverLive(result);
  assert.equal(Object.isFrozen(result), true);
  if (axisName !== null) {
    assert.equal(result.axes[axisName].state, 'NOT_PROVED');
  }
  if (reasonCode !== null) {
    assert.equal(result.reasonCodes.includes(reasonCode), true);
    assert.equal(result.axes[axisName].reasonCodes.includes(reasonCode), true);
  }
  return result;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function setPath(input, path, value) {
  let target = input;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = value;
  return input;
}

function rebindLifecycle(input) {
  const lifecycleReplayDigest =
    `sha256:${sha256(canonicalJson(input.lifecycle.events))}`;
  for (const fact of [
    input.validation,
    input.lifecycle.terminalCoverage,
    input.lifecycle.postFlat,
    input.reconciliation,
    input.disarm.postDisarm,
    input.entryAuthority,
    input.flattenAuthority,
    input.financials,
  ]) {
    fact.binding.lifecycleReplayDigest = lifecycleReplayDigest;
  }
  input.lifecycle.terminalCoverage.lifecycleReplayDigest =
    lifecycleReplayDigest;
  input.lifecycle.postFlat.lifecycleReplayDigest = lifecycleReplayDigest;
  input.reconciliation.lifecycleReplayDigest = lifecycleReplayDigest;
  return input;
}

test('positive-fill synthetic, replay, and LIVE_PRIVATE evidence remain validation-only', () => {
  const synthetic = generateM0AutomaticReceipt(inputFixture('SYNTHETIC_TEST'));
  assert.equal(
    synthetic.disposition,
    'PROVED',
    JSON.stringify(synthetic.reasonCodes),
  );
  assert.equal(synthetic.milestoneClaim, 'VALIDATION_PROVED');
  assertNeverLive(synthetic);

  const replay = generateM0AutomaticReceipt(inputFixture('RECORDED_REPLAY'));
  assert.equal(replay.disposition, 'PROVED');
  assert.equal(replay.milestoneClaim, 'VALIDATION_PROVED');
  assertNeverLive(replay);

  const liveInput = inputFixture('LIVE_PRIVATE');
  const live = generateM0AutomaticReceipt(liveInput);
  assert.equal(live.disposition, 'PROVED');
  assert.equal(live.milestoneClaim, 'VALIDATION_PROVED');
  assertNeverLive(live);
  const expectedEvidenceDigest =
    `sha256:${sha256(canonicalJson(liveInput))}`;
  assert.equal(live.inputEvidenceDigest, expectedEvidenceDigest);
  assert.equal(live.evidence.evidenceBundleDigest, expectedEvidenceDigest);
  assert.equal(live.evidence.privateSourceCutRevision,
    liveInput.reconciliation.privateSourceCutRevision);
  assert.equal(live.evidence.privateProjectionRevision,
    liveInput.lifecycle.postFlat.ownerRevision);
  assert.equal(live.evidence.reconciliationResultRevision,
    liveInput.reconciliation.ownerRevision);
  assert.equal(live.evidence.residualBaseQuantity, '0');
  assert.equal(live.evidence.disarmPreviewDigest,
    liveInput.disarm.preview.previewDigest);
  assert.deepEqual(
    Object.fromEntries(Object.entries(live.axes).map(([key, axis]) => [
      key,
      axis.state,
    ])),
    {
      identity: 'PROVED',
      validateOnly: 'PROVED',
      authorities: 'PROVED',
      flat: 'PROVED',
      reconciliation: 'PROVED',
      disarm: 'PROVED',
      financials: 'PROVED',
    },
  );
});

test('receipt is canonical SHA-256, deeply frozen, deterministic, and detached from input', () => {
  const input = inputFixture();
  const before = clone(input);
  const first = generateM0AutomaticReceipt(input);
  const second = generateM0AutomaticReceipt(clone(input));
  const reordered = generateM0AutomaticReceipt(Object.fromEntries(
    Object.entries(clone(input)).reverse(),
  ));

  assert.deepEqual(first, second);
  assert.deepEqual(first, reordered);
  assert.equal(first.receiptDigest.length, 64);
  assert.match(first.receiptDigest, /^[0-9a-f]{64}$/u);
  const { receiptDigest: _receiptDigest, ...digestCore } = first;
  assert.equal(first.receiptDigest, sha256(canonicalJson(digestCore)));
  assertDeepFrozen(first);
  assert.deepEqual(input, before, 'generation must not mutate caller input');

  input.validation.blockingCodes.push('FORGED_AFTER_GENERATION');
  input.lifecycle.events[0].eventId = 'mutated-after-generation';
  input.disarm.receipt.ledgerEventIds[0] = 999;
  input.financials.feesQuote = '999';
  assert.deepEqual(first, second, 'receipt must not retain mutable input aliases');

  const digestSensitive = inputFixture();
  digestSensitive.sourceCommitSha = 'b'.repeat(40);
  assert.notEqual(
    generateM0AutomaticReceipt(digestSensitive).receiptDigest,
    first.receiptDigest,
  );
});

test('lifecycle replay must be conflict-free, positive-fill, terminal, and exactly flat', () => {
  for (const mutate of [
    (input) => { input.lifecycle.events[6].type = 'FAILED'; },
    (input) => { input.lifecycle.events[6].venueOrderTerminal = true; },
    (input) => { input.lifecycle.events[6].cumulativeFlattenedQuantity = '0.00009'; },
    (input) => { input.lifecycle.events[3].cumulativeFilledQuantity = '0.0002'; },
    (input) => { input.lifecycle.events[6].cumulativeFlattenedQuantity = '0.0002'; },
    (input) => { input.lifecycle.events[3].cumulativeFilledQuantity = '0'; },
    (input) => { input.lifecycle.events[3].cumulativeFilledQuantity = '0.00010'; },
    (input) => { input.lifecycle.events[6].cumulativeFlattenedQuantity = '0'; },
    (input) => { input.lifecycle.events[4].sequence = 6; },
    (input) => {
      [input.lifecycle.events[4], input.lifecycle.events[5]] =
        [input.lifecycle.events[5], input.lifecycle.events[4]];
    },
    (input) => {
      input.lifecycle.events.push({
        ...clone(input.lifecycle.events[6]),
        type: 'FAILED',
        failureCode: 'FORGED_CONFLICT',
        venueOrderTerminal: true,
      });
    },
    (input) => { input.lifecycle.terminalCoverage.coveredThroughSequence = 6; },
    (input) => { input.lifecycle.terminalCoverage.coveredThroughSequence = 8; },
    (input) => { input.lifecycle.terminalCoverage.sourceOrderTerminal = false; },
    (input) => { input.lifecycle.terminalCoverage.flattenOrderTerminal = false; },
    (input) => { input.lifecycle.terminalCoverage.sourceFillsComplete = false; },
    (input) => { input.lifecycle.terminalCoverage.flattenFillsComplete = false; },
    (input) => { input.lifecycle.postFlat.openOrderCount = 1; },
    (input) => { input.lifecycle.postFlat.openOrdersComplete = false; },
    (input) => { input.lifecycle.postFlat.ordersComplete = false; },
    (input) => { input.lifecycle.postFlat.tradesComplete = false; },
    (input) => { input.lifecycle.postFlat.accountSnapshotComplete = false; },
    (input) => {
      input.lifecycle.postFlat.privateSourceCutRevision =
        `l05pcut_${sha256('wrong-private-cut')}`;
    },
    (input) => { input.lifecycle.postFlat.status = 'PARTIAL'; },
    (input) => { input.lifecycle.postFlat.scope = 'SYMBOL_ONLY'; },
  ]) {
    const input = inputFixture();
    mutate(input);
    assertNotProved(rebindLifecycle(input), 'flat');
  }
});

test('every non-EXACT or incomplete reconciliation state fails closed', () => {
  for (const canonicalStatus of [
    'PENDING',
    'PARTIAL',
    'AMBIGUOUS',
    'DIVERGED',
    'STALE',
    'UNAVAILABLE',
  ]) {
    assertNotProved(setPath(
      inputFixture(),
      ['reconciliation', 'canonicalStatus'],
      canonicalStatus,
    ), 'reconciliation', 'RECONCILIATION_NOT_EXACT');
  }
  for (const [path, value] of [
    [['reconciliation', 'ledgerState'], 'UNMATCHED'],
    [['reconciliation', 'coverage'], 'SYMBOL_ONLY'],
    [['reconciliation', 'sourceOrderCovered'], false],
    [['reconciliation', 'flattenOrderCovered'], false],
    [['reconciliation', 'fillsCovered'], false],
    [['reconciliation', 'feesCovered'], false],
    [['reconciliation', 'residualBaseQuantity'], '0.00000001'],
    [['reconciliation', 'accountDeltaExact'], false],
  ]) {
    assertNotProved(
      setPath(inputFixture(), path, value),
      'reconciliation',
      'RECONCILIATION_NOT_EXACT',
    );
  }

  const wrongProjection = inputFixture();
  wrongProjection.lifecycle.postFlat.ownerRevision =
    `l05proj_${sha256('wrong-private-projection')}`;
  assertNotProved(wrongProjection, 'flat', 'POST_FLAT_TRUTH_INVALID');

  for (const [path, value] of [
    [['lifecycle', 'postFlat', 'observedAtMs'], NOW - 1_001],
    [['lifecycle', 'postFlat', 'validUntilMs'], NOW + 19_999],
    [['reconciliation', 'observedAtMs'], NOW - 1_001],
    [['reconciliation', 'validUntilMs'], NOW + 19_999],
  ]) {
    assertNotProved(
      setPath(inputFixture(), path, value),
      'reconciliation',
      'EVIDENCE_CHRONOLOGY_INVALID',
    );
  }

  const olderThanPrivateCurrentCap = inputFixture();
  olderThanPrivateCurrentCap.lifecycle.postFlat.observedAtMs = NOW - 5_001;
  olderThanPrivateCurrentCap.reconciliation.observedAtMs = NOW - 5_001;
  assertNotProved(
    olderThanPrivateCurrentCap,
    'flat',
    'POST_FLAT_TRUTH_INVALID',
  );
});

test('stale, future, incomplete, and mixed-identity evidence fails closed', () => {
  const factPaths = [
    ['validation'],
    ['lifecycle', 'terminalCoverage'],
    ['lifecycle', 'postFlat'],
    ['reconciliation'],
    ['disarm', 'postDisarm'],
    ['financials'],
  ];
  for (const path of factPaths) {
    assertNotProved(setPath(
      inputFixture(),
      [...path, 'observedAtMs'],
      NOW - MAX_AGE_MS - 1,
    ));
    assertNotProved(setPath(
      inputFixture(),
      [...path, 'observedAtMs'],
      NOW + 1,
    ));
    assertNotProved(setPath(
      inputFixture(),
      [...path, 'validUntilMs'],
      NOW,
    ));
    assertNotProved(setPath(
      inputFixture(),
      [...path, 'binding', 'ticketId'],
      'spt_mixed_identity',
    ));
    for (const [field, value] of [
      ['termsDigest', 'mixed-terms-digest'],
      ['clientOrderId', 'mixed-client-order-id'],
      ['flattenClientOrderId', 'mixed-flatten-order-id'],
      ['accountId', 'mixed-account'],
      ['symbol', 'ETHUSDT'],
      ['sourceVenueOrderId', 'mixed-source-order'],
      ['flattenVenueOrderId', 'mixed-flatten-order'],
      ['lifecycleReplayDigest', `sha256:${sha256('mixed-lifecycle')}`],
      ['privateSourceCutRevision', `l05pcut_${sha256('mixed-private-cut')}`],
      [
        'privateProjectionRevision',
        `l05proj_${sha256('mixed-private-projection')}`,
      ],
      [
        'reconciliationResultRevision',
        `foundation-reconciliation-result:${sha256('mixed-reconciliation')}`,
      ],
    ]) {
      assertNotProved(setPath(
        inputFixture(),
        [...path, 'binding', field],
        value,
      ));
    }
  }
  assertNotProved(setPath(
    inputFixture(),
    ['flattenAuthority', 'binding', 'correlationId'],
    'mixed-correlation',
  ));
  for (const authority of ['entryAuthority', 'flattenAuthority']) {
    assertNotProved(setPath(
      inputFixture(),
      [authority, 'confirmedAtMs'],
      NOW + 1,
    ));
    const stale = inputFixture();
    stale[authority].confirmedAtMs = NOW - MAX_AGE_MS - 2;
    stale[authority].consumedAtMs = NOW - MAX_AGE_MS - 1;
    assertNotProved(stale);
    assertNotProved(setPath(
      inputFixture(),
      [authority, 'consumedAtMs'],
      NOW + 1,
    ));
  }
  assertNotProved(setPath(inputFixture(), ['evaluatedAtMs'], -1));
  assertNotProved(setPath(inputFixture(), ['maxEvidenceAgeMs'], 0));
  const excessiveEvidenceAge = assertNotProved(setPath(
    inputFixture(),
    ['maxEvidenceAgeMs'],
    MAX_AGE_MS + 1,
  ));
  assert.equal(excessiveEvidenceAge.reasonCodes.includes('INPUT_INVALID'), true);
  for (const [path, value] of [
    [['ticket', 'termsDigest'], 'tampered-terms'],
    [['ticket', 'clientOrderId'], 'tampered-client-order-id'],
    [['ticket', 'orderNotionalQuote'], '9.99'],
    [['ticket', 'quantity'], '0.0002'],
  ]) {
    assertNotProved(setPath(inputFixture(), path, value));
  }
});

test('validate-only evidence is exact and cannot smuggle signed or external effects', () => {
  for (const [path, value] of [
    [['validation', 'mode'], 'LIVE'],
    [['validation', 'localValidationPassed'], false],
    [['validation', 'blockingCodes'], ['FILTER_VALIDATION_FAILED']],
    [['validation', 'signedTestPerformed'], true],
    [['validation', 'liveSendAuthorized'], true],
    [['validation', 'sendsPerformed'], 1],
    [['validation', 'sideEffectsPerformed'], 1],
    [['validation', 'externalActionAuthorization'], 'LIVE'],
    [['validation', 'permittedExternalActions'], ['SIGNED_TEST_ORDER']],
  ]) {
    assertNotProved(
      setPath(inputFixture(), path, value),
      'validateOnly',
      'VALIDATE_ONLY_FACT_INVALID',
    );
  }
});

test('malformed or policy-breaking financial decimals never prove the milestone', () => {
  assertNotProved(setPath(inputFixture(), ['ticket', 'quantity'], '1e-4'));
  for (const [path, value] of [
    [['financials', 'cashCommittedQuote'], '10.0000000000000000001'],
    [['financials', 'cashCommittedQuote'], '10.01'],
    [['financials', 'cashCommittedQuote'], '0.01'],
    [['financials', 'cashCommittedQuote'], 'NaN'],
    [['financials', 'orderNotionalQuote'], '9.99'],
    [['financials', 'flattenNotionalQuote'], '0.01'],
    [['financials', 'flattenNotionalQuote'], '10.01'],
    [['financials', 'grossExposureQuote'], '-1'],
    [['financials', 'grossExposureQuote'], '10.01'],
    [['financials', 'grossExposureQuote'], '0.01'],
    [['financials', 'feesQuote'], '-0.01'],
    [['financials', 'feeCoverageComplete'], false],
    [['financials', 'fees'], []],
    [[
      'financials',
      'fees',
    ], [{ asset: 'USDT', quantity: '0.02', quoteEquivalent: '0.02' }]],
    [['financials', 'quoteAsset'], 'BUSD'],
    [['financials', 'maximumLossQuote'], '0.10000001'],
  ]) {
    assertNotProved(
      setPath(inputFixture(), path, value),
      'financials',
      'FINANCIAL_FACT_INVALID',
    );
  }
  for (const [path, value] of [
    [['entryAuthority', 'consumedNotionalQuote'], '0'],
    [['entryAuthority', 'maxOrderNotionalQuote'], '9.99'],
    [['entryAuthority', 'maxOrderNotionalQuote'], '10.01'],
    [['flattenAuthority', 'consumedNotionalQuote'], '0'],
    [['flattenAuthority', 'consumedNotionalQuote'], '0.01'],
  ]) {
    assertNotProved(
      setPath(inputFixture(), path, value),
      'authorities',
      'AUTHORITY_FACT_INVALID',
    );
  }
});

test('durable DISARM must be an exact applied preview/receipt pair with safe post-state', () => {
  for (const [path, value] of [
    [['disarm', 'preview', 'action', 'type'], 'ARM'],
    [['disarm', 'preview', 'externalActionAuthorization'], 'LIVE'],
    [['disarm', 'preview', 'expiresAtMs'], NOW],
    [['disarm', 'preview', 'generatedAtMs'], NOW + 1],
    [['disarm', 'preview', 'riskWitness'], {
      truthRevision: 'truth-1',
      measureRevision: 'measure-1',
      currentValue: '0',
      maximumPostActionValue: '0',
      evaluatedAtMs: NOW - 2_000,
      authority: 'FOUNDATION_RISK',
    }],
    [['disarm', 'preview', 'actionDigest'], sha256('wrong-action')],
    [['disarm', 'preview', 'previewDigest'], sha256('wrong-preview-shape')],
    [['disarm', 'preview', 'authorizationTag'], 'l14tag_forged-forged'],
    [['disarm', 'receipt', 'commandId'], `cmd_${'f'.repeat(32)}`],
    [['disarm', 'receipt', 'previewDigest'], sha256('wrong-preview')],
    [['disarm', 'receipt', 'actionType'], 'ARM'],
    [['disarm', 'receipt', 'disposition'], 'NOOP'],
    [['disarm', 'receipt', 'reasonCode'], 'CONTROL_NOOP'],
    [['disarm', 'receipt', 'applied'], false],
    [['disarm', 'receipt', 'actorBinding'], `l14actor_${'f'.repeat(64)}`],
    [['disarm', 'receipt', 'expectedConfigVersion'], 8],
    [['disarm', 'receipt', 'committedControlRevision'], 11],
    [['disarm', 'receipt', 'recordedAtMs'], NOW - 2_001],
    [['disarm', 'receipt', 'recordedAtMs'], NOW + 1],
    [['disarm', 'receipt', 'ledgerEventIds'], [101, 101]],
    [['disarm', 'receipt', 'recoveryStateChanged'], true],
    [['disarm', 'receipt', 'externalActionAuthorization'], 'LIVE'],
    [['disarm', 'postDisarm', 'armId'], 'wrong-arm'],
    [['disarm', 'postDisarm', 'armRevision'], 'wrong-arm-revision'],
    [['disarm', 'postDisarm', 'armDigest'], `sha256:${sha256('wrong-arm')}`],
    [['disarm', 'postDisarm', 'controlRevision'], 11],
    [['disarm', 'postDisarm', 'status'], 'ARMED'],
    [['disarm', 'postDisarm', 'armed'], true],
    [['disarm', 'postDisarm', 'newRiskBlocked'], false],
    [['disarm', 'postDisarm', 'liveSendAuthorized'], true],
    [['disarm', 'postDisarm', 'observedAtMs'], NOW - 1_501],
  ]) {
    const section = path[1];
    const reasonCode = section === 'preview'
      ? 'DISARM_PREVIEW_INVALID'
      : section === 'receipt'
        ? 'DISARM_RECEIPT_INVALID'
        : 'POST_DISARM_TRUTH_INVALID';
    assertNotProved(
      setPath(inputFixture(), path, value),
      'disarm',
      reasonCode,
    );
  }
});

test('both authorities must be distinct, current, single-use, and consumed exactly once', () => {
  for (const [path, value] of [
    [['entryAuthority'], null],
    [['flattenAuthority'], null],
    [['entryAuthority', 'verification'], 'UNVERIFIED'],
    [['entryAuthority', 'singleUse'], false],
    [['entryAuthority', 'consumed'], false],
    [['entryAuthority', 'consumptionCount'], 0],
    [['entryAuthority', 'confirmedAtMs'], NOW + 1],
    [['entryAuthority', 'expiresAtMs'], NOW - 4_000],
    [['entryAuthority', 'consumedAtMs'], NOW + 1],
    [['entryAuthority', 'consumedAtMs'], NOW - 5_000],
    [['entryAuthority', 'consumedAtMs'], NOW + 5_000],
    [['flattenAuthority', 'phase'], 'ENTRY'],
  ]) {
    assertNotProved(setPath(inputFixture(), path, value));
  }
  const reusedId = inputFixture();
  reusedId.flattenAuthority.authorizationId =
    reusedId.entryAuthority.authorizationId;
  assertNotProved(reusedId);

  const lateFlatten = inputFixture();
  lateFlatten.flattenAuthority.confirmedAtMs = NOW - 900;
  lateFlatten.flattenAuthority.consumedAtMs = NOW - 800;
  assertNotProved(
    lateFlatten,
    'authorities',
    'EVIDENCE_CHRONOLOGY_INVALID',
  );

  const lateEntry = inputFixture();
  lateEntry.entryAuthority.confirmedAtMs = NOW - 900;
  lateEntry.entryAuthority.consumedAtMs = NOW - 800;
  lateEntry.flattenAuthority.confirmedAtMs = NOW - 700;
  lateEntry.flattenAuthority.consumedAtMs = NOW - 600;
  assertNotProved(
    lateEntry,
    'authorities',
    'EVIDENCE_CHRONOLOGY_INVALID',
  );

});

test('every receipt input record is versioned and closed', () => {
  const records = [
    [],
    ['ticket'],
    ['validation'],
    ['validation', 'binding'],
    ['lifecycle'],
    ['lifecycle', 'terminalCoverage'],
    ['lifecycle', 'terminalCoverage', 'binding'],
    ['lifecycle', 'postFlat'],
    ['lifecycle', 'postFlat', 'binding'],
    ['reconciliation'],
    ['reconciliation', 'binding'],
    ['disarm', 'preview'],
    ['disarm', 'preview', 'action'],
    ['disarm', 'preview', 'action', 'arm'],
    ['disarm', 'receipt'],
    ['disarm', 'postDisarm'],
    ['disarm', 'postDisarm', 'binding'],
    ['disarm'],
    ['entryAuthority'],
    ['entryAuthority', 'binding'],
    ['flattenAuthority'],
    ['flattenAuthority', 'binding'],
    ['financials'],
    ['financials', 'binding'],
  ];
  for (const path of records) {
    const unknown = inputFixture();
    let target = unknown;
    for (const key of path) target = target[key];
    target.unknownField = true;
    assertNotProved(unknown);
  }
  for (const path of [
    [],
    ['validation'],
    ['validation', 'binding'],
    ['lifecycle'],
    ['lifecycle', 'terminalCoverage'],
    ['lifecycle', 'postFlat'],
    ['reconciliation'],
    ['disarm', 'preview'],
    ['disarm', 'receipt'],
    ['disarm', 'postDisarm'],
    ['entryAuthority'],
    ['flattenAuthority'],
    ['financials'],
  ]) {
    assertNotProved(setPath(inputFixture(), [...path, 'version'], 2));
    assertNotProved(setPath(
      inputFixture(),
      [...path, 'schema'],
      'cosmos.forged-schema.v999',
    ));
  }
  const unknownEvent = inputFixture();
  unknownEvent.lifecycle.events[0].unknownField = true;
  assertNotProved(rebindLifecycle(unknownEvent));
  assertNotProved(setPath(
    inputFixture(),
    ['ticket', 'schema'],
    'cosmos.forged-spot-ticket.v999',
  ));
});

test('hostile JavaScript values and non-closed objects never throw or prove', () => {
  const throwingProxy = new Proxy({}, {
    ownKeys() { throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() { throw new Error('descriptor trap'); },
    get() { throw new Error('get trap'); },
  });
  const accessor = {};
  Object.defineProperty(accessor, 'schema', {
    enumerable: true,
    get() { throw new Error('getter must not run'); },
  });
  const symbolKeyed = inputFixture();
  symbolKeyed[Symbol('hidden')] = true;
  class ForgedInput {
    constructor() {
      Object.assign(this, inputFixture());
    }
  }
  const cycle = inputFixture();
  cycle.self = cycle;
  const sparse = inputFixture();
  sparse.lifecycle.events = new Array(8);
  const unknownTop = { ...inputFixture(), liveRoute: () => 'forbidden' };
  const unknownNested = inputFixture();
  unknownNested.validation.unknown = true;
  const nestedProxy = inputFixture();
  nestedProxy.validation = throwingProxy;
  const nestedAccessor = inputFixture();
  Object.defineProperty(nestedAccessor.lifecycle.events[0], 'type', {
    enumerable: true,
    get() { throw new Error('nested getter must not run'); },
  });
  const oversizedEvents = inputFixture();
  oversizedEvents.lifecycle.events.push(
    ...Array.from(
      { length: 10_001 },
      () => clone(oversizedEvents.lifecycle.events.at(-1)),
    ),
  );
  const oversizedIdentity = inputFixture();
  oversizedIdentity.validation.ownerRevision = 'x'.repeat(10_001);
  const pollutedPrototype = Object.assign(
    Object.create({ polluted: true }),
    inputFixture(),
  );
  const ownProto = inputFixture();
  Object.defineProperty(ownProto, '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  const prototypeField = inputFixture();
  prototypeField.prototype = { polluted: true };
  const nonEnumerable = inputFixture();
  Object.defineProperty(nonEnumerable.validation, 'hidden', {
    value: true,
    enumerable: false,
  });
  const tooDeep = inputFixture();
  let deepCursor = tooDeep;
  for (let depth = 0; depth < 24; depth += 1) {
    deepCursor.deepPayload = {};
    deepCursor = deepCursor.deepPayload;
  }
  const tooManyNodes = inputFixture();
  tooManyNodes.nodePayload = Array.from(
    { length: 512 },
    () => Array(8).fill(null),
  );
  const rawLifecyclePayload = inputFixture();
  rawLifecyclePayload.lifecycle.events[0].rawPayload = {
    source: 'untrusted-lifecycle-payload',
  };
  rebindLifecycle(rawLifecyclePayload);
  const credentialShapes = [
    `AKIA${'A'.repeat(16)}`,
    `sk_${'a'.repeat(24)}`,
    `eyJ${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(10)}`,
    'api_secret=abcdefghijklmnop',
  ].map((credentialShape) => ({
    ...inputFixture(),
    credentialShape,
  }));

  for (const value of [
    throwingProxy,
    accessor,
    symbolKeyed,
    new ForgedInput(),
    cycle,
    sparse,
    unknownTop,
    unknownNested,
    nestedProxy,
    nestedAccessor,
    oversizedEvents,
    oversizedIdentity,
    pollutedPrototype,
    ownProto,
    prototypeField,
    nonEnumerable,
    tooDeep,
    tooManyNodes,
    rawLifecyclePayload,
    ...credentialShapes,
    undefined,
    null,
    1,
    'forged',
  ]) {
    let result;
    assert.doesNotThrow(() => {
      result = generateM0AutomaticReceipt(value);
    });
    assert.equal(result.disposition, 'NOT_PROVED');
    assertNeverLive(result);
  }
});

test('compiled receipt generator has no ambient or action-capable seam', async () => {
  const source = await readFile(new URL(
    '../../../dist/systemIntegration/evidence/m0AutomaticReceipt.js',
    import.meta.url,
  ), 'utf8');
  assert.deepEqual(
    [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)]
      .map((match) => match[1])
      .sort(),
    [
      'node:crypto',
      'node:util/types',
      '../../foundation/contracts/identity.js',
      '../../foundation/exchange/binanceSpot/filters.js',
      '../../foundation/execution/spotLifecycle.js',
      '../../foundation/execution/spotTicket.js',
      '../../foundation/reconciliation/spotLedgerBridge.js',
      '../../liveEdge/controls/integrity.js',
      '../../liveEdge/controls/validation.js',
    ].sort(),
  );
  for (const [label, pattern] of [
    ['environment', /\bprocess\s*\.\s*env\b/u],
    ['ambient clock', /\bDate\s*\.\s*now\s*\(/u],
    ['randomness', /\bMath\s*\.\s*random\s*\(/u],
    ['filesystem', /(?:node:fs|from\s+['"]fs['"])/u],
    ['http', /(?:node:http|node:https|from\s+['"]https?['"])/u],
    ['network', /(?:node:net|node:tls|node:dgram)/u],
    ['dns', /node:dns/u],
    ['subprocess', /node:child_process/u],
    ['worker', /node:worker_threads/u],
    ['database', /(?:node:sqlite|better-sqlite|postgres|mysql|drizzle)/iu],
    ['timer', /\b(?:setTimeout|setInterval|setImmediate)\s*\(/u],
    ['fetch', /\bfetch\s*\(/u],
    ['browser network', /\b(?:WebSocket|XMLHttpRequest|sendBeacon)\b/u],
    ['native binding', /\bprocess\s*\.\s*binding\s*\(/u],
    ['random bytes', /\b(?:randomBytes|randomUUID)\s*\(/u],
    ['provider client', /\b(?:BinanceClient|createBinance|signedRequest)\b/u],
    ['private read', /\b(?:apiRestrictions|openOrders|myTrades|positionRisk)\b/u],
    ['route', /\b(?:Router|createRoute|routeHandler|app\.(?:get|post|put|delete))\b/u],
    ['action call', /\.(?:send|submit|dispatch|execute|cancel|flatten|disarm)\s*\(/u],
    ['write call', /\.(?:append|write|publish)\s*\(/u],
  ]) {
    assert.doesNotMatch(source, pattern, label);
  }
});

test('ambient runtime traps remain untouched and every output is hard inert', () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalSetImmediate = globalThis.setImmediate;
  const originalDateNow = Date.now;
  const originalMathRandom = Math.random;
  const calls = [];
  const trap = (name) => () => {
    calls.push(name);
    throw new Error(`${name} must not be called`);
  };
  try {
    globalThis.fetch = trap('fetch');
    globalThis.setTimeout = trap('setTimeout');
    globalThis.setInterval = trap('setInterval');
    globalThis.setImmediate = trap('setImmediate');
    Date.now = trap('Date.now');
    Math.random = trap('Math.random');
    const results = [
      generateM0AutomaticReceipt(inputFixture()),
      generateM0AutomaticReceipt(inputFixture('SYNTHETIC_TEST')),
      generateM0AutomaticReceipt({ forged: true }),
    ];
    assert.deepEqual(calls, []);
    for (const result of results) {
      assert.equal(result.mode, 'VALIDATE_ONLY');
      assert.equal(result.executionAuthority, 'NONE');
      assert.equal(result.routeAuthority, 'NONE');
      assert.equal(result.persistenceAuthorization, 'NONE');
      assert.equal(result.externalActionAuthorization, 'NONE');
      assert.deepEqual(result.permittedExternalActions, []);
      assert.equal(result.sendsPerformed, 0);
      assert.equal(result.sideEffectsPerformed, 0);
      assert.equal(result.networkCallsPerformed, 0);
      assert.equal(result.credentialReadsPerformed, 0);
      assert.equal(result.privateReadsPerformed, 0);
      assert.equal(result.providerCallsPerformed, 0);
      assert.equal(result.moneyMutationsPerformed, 0);
      assert.equal(result.persistenceWritesPerformed, 0);
      assert.equal(result.controlMutationsPerformed, 0);
      assert.equal(result.liveCanaryProven, false);
      assert.equal(result.moneyMovementProven, false);
      assert.equal(result.providerAcceptance, 'NOT_CLAIMED');
      assert.equal(result.claimBoundary, 'TRANSPORT_ONLY');
      assert.match(result.receiptDigest, /^[a-f0-9]{64}$/u);
      if (result.inputEvidenceDigest !== null) {
        assert.match(result.inputEvidenceDigest, /^sha256:[a-f0-9]{64}$/u);
      }
      assertDeepFrozen(result);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.setImmediate = originalSetImmediate;
    Date.now = originalDateNow;
    Math.random = originalMathRandom;
  }
});
