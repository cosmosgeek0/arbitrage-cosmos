import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  createConservativeEconomicFactBinding,
  deriveCapitalConfigRevision,
  deriveAllocationDecisionId,
  deriveCapitalMandateId,
  deriveOpportunityConsiderationId,
} from '../../../dist/capitalFoundation/contracts/index.js';
import { deriveCapitalBudgetPolicyRevision } from '../../../dist/capitalFoundation/budgets/index.js';
import { projectActivePosition } from '../../../dist/capitalFoundation/positions/index.js';
import {
  EMPTY_RESERVATION_BOOK,
  allocateCapital,
  deriveAllocationSizingAuthorityRevision,
  reduceReservationBook,
  validateAllocationCandidate,
} from '../../../dist/capitalFoundation/allocation/index.js';
import { MAX_UTC_MS } from '../../../dist/foundation/contracts/index.js';

const NOW = 1_800_000_000_000;
const ELIGIBILITY_POLICY_REVISION = deriveCapitalConfigRevision('allocation-test-eligibility', { revision: 1 });
const bound = (value) => ({ value, minimum: '0', maximum: '1000000', unit: 'USDT' });
const integerBound = (value, maximum, unit = 'COUNT') => ({ value, minimum: 0, maximum, unit });

function economicFact(kind, value, sourceId, valuationAsset = 'USDT') {
  return createConservativeEconomicFactBinding({
    kind,
    owner: {
      FUNDING: 'BASIS_ENGINE',
      BORROW: 'FOUNDATION_BORROW_TRUTH',
      CAPITAL_OPPORTUNITY: 'CAPITAL_FOUNDATION',
    }[kind],
    value,
    unit: valuationAsset,
    source: {
      sourceTimeMs: NOW - 10,
      receivedAtMs: NOW - 5,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
    },
    ownerRevision: `${sourceId}-r1`,
    completeness: 'COMPLETE',
    evidenceIds: [`${sourceId}-e1`],
  });
}

function truth(overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 10, receivedAtMs: NOW - 5, maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'allocation-test',
    },
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    ...overrides,
  });
}

function reservationTruth(evaluatedAtMs = NOW) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: evaluatedAtMs - 10, receivedAtMs: evaluatedAtMs - 5, maxAgeMs: 100_000,
      authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'reservation-authority-test',
    },
    evaluatedAtMs,
    requiredValuePresent: true,
    revision: `truth-${evaluatedAtMs}`,
  });
}

function policy(overrides = {}) {
  const draft = {
    authority: {
      revision: 'pending-content-revision',
      sourceId: 'allocation-policy', issuedAtMs: NOW - 2_000,
      effectiveFromMs: NOW - 1_000, effectiveUntilMs: NOW + 100_000,
    },
    valuationAsset: 'USDT',
    portfolioGrossLimit: bound('1000'), portfolioNetLimit: bound('400'),
    perStrategyLimits: { BASIS: bound('800'), VOLUME: bound('200') },
    perSymbolLimit: bound('500'), perCorrelatedGroupLimit: bound('600'),
    perVenueInstrumentLimit: bound('500'), riskReductionReserve: bound('100'),
    maximumConcurrentPlans: integerBound(10, 20), maximumActivePositions: integerBound(10, 20),
    reservationTtlMs: integerBound(10_000, 60_000, 'MILLISECONDS'),
    ...overrides,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'authority')) return draft;
  return {
    ...draft,
    authority: { ...draft.authority, revision: deriveCapitalBudgetPolicyRevision(draft) },
  };
}

function snapshot(overrides = {}) {
  const entryCollateralAvailable = overrides.entryCollateralAvailable ?? '500';
  const protectedRiskReductionReserve = overrides.protectedRiskReductionReserve ?? '100';
  const otherUnavailableCollateral = overrides.collateralPoolBinding?.otherUnavailableCollateral ?? '0';
  const currentConcurrentPlans = overrides.currentConcurrentPlans ?? 0;
  const currentActivePositions = overrides.currentActivePositions ?? 0;
  const commitments = overrides.commitments ?? [
    ...Array.from({ length: currentConcurrentPlans }, (_, index) => ({
      id: `plan-${index}`, capitalClaimKey: `plan-claim-${index}`, kind: 'STAGED_PLAN',
    })),
    ...Array.from({ length: currentActivePositions }, (_, index) => ({
      id: `position-${index}`, capitalClaimKey: `position-claim-${index}`, kind: 'ACTIVE_POSITION',
    })),
  ];
  return {
    valuationAsset: 'USDT', truth: truth(),
    entryCollateralAvailable, protectedRiskReductionReserve,
    collateralPoolBinding: overrides.collateralPoolBinding ?? {
      sourcePoolId: 'ACCOUNT:USDT:COLLATERAL',
      sourcePoolTotal: addExactDecimals(addExactDecimals(entryCollateralAvailable, protectedRiskReductionReserve), otherUnavailableCollateral),
      otherUnavailableCollateral,
    },
    marginHeadroomAvailable: '500',
    grossExposureAndCommitments: '0', netDirectionalExposure: '0',
    strategyUse: [], symbolUse: [], correlatedGroupUse: [], venueInstrumentUse: [],
    currentConcurrentPlans, currentActivePositions,
    borrowCapacityByAsset: [{ key: 'BTC', amount: '500' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '500' }, { key: 'ETH:SPOT', amount: '500' }],
    commitmentCoverage: {
      orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
    },
    commitments,
    ...overrides,
  };
}

function candidate(key, amount = '80', overrides = {}) {
  const symbol = overrides.primarySymbol ?? (key.includes('eth') ? 'ETHUSDT' : 'BTCUSDT');
  const eligibilityStatus = overrides.eligibilityStatus ?? 'ELIGIBLE';
  const considerationMode = overrides.considerationMode ?? 'MANUAL_ARMED';
  const candidateTruth = overrides.truth ?? truth();
  const strategy = overrides.strategy ?? 'BASIS';
  const valuationAsset = overrides.valuationAsset ?? 'USDT';
  const economicDirection = overrides.economicDirection ?? 'HEDGED';
  const requestedAmount = overrides.requestedAmount ?? amount;
  const borrowRequired = Object.prototype.hasOwnProperty.call(overrides, 'borrowRequired')
    ? overrides.borrowRequired
    : false;
  const conflictingConsiderationIds = overrides.conflictingConsiderationIds ?? [];
  const proposal = {
    sourceProposalId: `proposal-${key}`,
    canonicalProposalId: `canonical-${key}`,
    sourceCorrelationId: `correlation-${key}`,
    strategy,
    symbol,
    direction: economicDirection === 'HEDGED' ? 'long_spot_short_perp' : economicDirection.toLowerCase(),
    sourceLifecycle: 'OPEN',
    sourceRevision: 'proposal-r1',
    sourceConfigRevision: 'proposal-config-r1',
    createdAtMs: NOW - 100,
    updatedAtMs: NOW - 50,
    expiresAtMs: NOW + 100_000,
    intakeDigest: capitalDigest({ key, intake: 1 }),
  };
  const considerationId = deriveOpportunityConsiderationId({
    proposalId: proposal.sourceProposalId,
    proposalRevision: proposal.sourceRevision,
    intakeDigest: proposal.intakeDigest,
    policyRevision: ELIGIBILITY_POLICY_REVISION,
  });
  const consideration = overrides.consideration ?? {
    id: considerationId,
    proposal,
    mode: considerationMode,
    status: eligibilityStatus,
    reasons: [],
    legs: economicDirection === 'HEDGED'
      ? [
        { role: 'SPOT', instrumentId: `${symbol}:SPOT`, symbol, side: 'LONG', borrowRequired },
        { role: 'PERPETUAL', instrumentId: `${symbol}:PERP`, symbol, side: 'SHORT', borrowRequired: false },
      ]
      : [{
        role: 'DIRECTIONAL', instrumentId: `${symbol}:DIRECTIONAL`, symbol,
        side: economicDirection === 'SHORT' ? 'SHORT' : economicDirection === 'LONG' ? 'LONG' : 'UNKNOWN',
        borrowRequired,
      }],
    economics: {
      valuationAsset,
      requestedCapital: requestedAmount,
      expectedGrossEdge: '0', expectedNetEdge: '0', estimatedFees: '0', estimatedFunding: '0',
      estimatedBorrowCost: '0', estimatedSpreadCost: '0', estimatedSlippage: '0',
      estimatedLatencyCost: '0', estimatedAdverseSelectionCost: '0',
      estimatedRecoveryCost: '0', estimatedCapitalOpportunityCost: '0',
      liquidityCapacity: requestedAmount,
      fundingFact: economicFact('FUNDING', '0', `funding-${key}`, valuationAsset),
      borrowFact: economicFact('BORROW', '0', `borrow-${key}`, valuationAsset),
      capitalOpportunityFact: economicFact(
        'CAPITAL_OPPORTUNITY',
        '0',
        `capital-opportunity-${key}`,
        valuationAsset,
      ),
      exactSourceIds: [`source-${key}`], missingFields: [],
    },
    evidencePacketIds: [],
    evidenceTruth: 'COMPLETE',
    truth: candidateTruth,
    conflictingConsiderationIds,
    evaluatedAtMs: NOW,
  };
  const draft = {
    consideration,
    considerationId: consideration.id,
    considerationDigest: capitalDigest(consideration),
    eligibilityPolicyRevision: ELIGIBILITY_POLICY_REVISION,
    sizingAuthority: { revision: 'pending', sourceId: 'allocation-test-sizing' },
    eligibilityStatus, considerationMode, truth: candidateTruth,
    strategy, valuationAsset, primarySymbol: symbol, economicDirection,
    requestedAmount, grossExposureIncrease: amount, netDirectionalExposureDelta: '0',
    collateralRequired: requestedAmount, marginRequired: requestedAmount,
    strategyRequirements: [{ key: strategy, amount: requestedAmount }],
    symbolRequirements: [{ key: symbol, amount: requestedAmount }],
    correlatedGroupRequirements: [{ key: symbol.startsWith('ETH') ? 'ETH' : 'BTC', amount: requestedAmount }],
    venueInstrumentRequirements: [{ key: `BINANCE:${symbol}:PAIR`, amount: requestedAmount }],
    borrowRequired, borrowRequirements: borrowRequired === true ? [{ key: symbol.startsWith('ETH') ? 'ETH' : 'BTC', amount: requestedAmount }] : [],
    liquidityRequirements: [{ key: symbol.startsWith('ETH') ? 'ETH:SPOT' : 'BTC:SPOT', amount: requestedAmount }],
    conflictingConsiderationIds,
    ...overrides,
  };
  return reissueSizing({
    ...draft,
  });
}

function reissueSizing(draft) {
  return {
    ...draft,
    sizingAuthority: {
      ...draft.sizingAuthority,
      revision: deriveAllocationSizingAuthorityRevision(draft),
    },
  };
}

function run(candidates, snapshotOverrides = {}, policyOverrides = {}) {
  return allocateCapital({ policy: policy(policyOverrides), snapshot: snapshot(snapshotOverrides), candidates, nowMs: NOW });
}

test('scarce collateral grants canonical consideration identity first with a complete capped audit', () => {
  const one = candidate('identity-one', '80');
  const two = candidate('eth-identity-two', '80');
  const [first, second] = [one, two].sort((left, right) => left.considerationId < right.considerationId ? -1 : 1);
  const result = run([second, first], { entryCollateralAvailable: '100' });
  assert.deepEqual(result.decisions.map((d) => [d.considerationId, d.status, d.grantedAmount]), [
    [first.considerationId, 'GRANTED', '80'], [second.considerationId, 'CAPPED', '20'],
  ]);
  assert.equal(result.remainder.entryCollateralAvailable, '0');
  assert.ok(result.decisions[1].audit.some((step) => step.code === 'ENTRY_COLLATERAL' && step.before === '80' && step.after === '20'));
});

test('tie break and byte-equivalent decisions do not depend on input order', () => {
  const a = candidate('a', '70');
  const b = candidate('eth-b', '70');
  const first = run([a, b], { entryCollateralAvailable: '100' });
  const second = run([b, a], { entryCollateralAvailable: '100' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.decisions.map((d) => d.grantedAmount), ['70', '30']);
});

test('duplicate consideration cannot double allocate even when replayed in one batch', () => {
  const same = candidate('same');
  const result = run([same, { ...same }]);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('DUPLICATE_CONSIDERATION_ID'));
});

test('divergent duplicate consideration payloads block deterministically under input permutation', () => {
  const first = candidate('same-divergent', '80');
  const second = { ...first, requestedAmount: '70', grossExposureIncrease: '70', collateralRequired: '70', marginRequired: '70' };
  assert.deepEqual(run([first, second]), run([second, first]));
  assert.equal(run([first, second]).decisions[0].status, 'BLOCKED');
  assert.ok(run([first, second]).decisions[0].blockingReasons.includes('DUPLICATE_CONSIDERATION_ID'));
});

test('same-symbol opposing opportunities are blocked as conflict', () => {
  const long = candidate('long', '50', { economicDirection: 'LONG', netDirectionalExposureDelta: '50' });
  const short = candidate('short', '50', { economicDirection: 'SHORT', netDirectionalExposureDelta: '-50' });
  const result = run([short, long]);
  assert.deepEqual(result.decisions.map((d) => d.status), ['BLOCKED', 'BLOCKED']);
  assert.ok(result.decisions.every((d) => d.blockingReasons.includes('CONFLICTING_OPPORTUNITY')));
});

test('unknown required eligibility, truth, direction, borrow, or capacity fails closed', () => {
  const invalid = candidate('invalid', '50', {
    considerationMode: 'VALIDATE_ONLY', economicDirection: 'UNKNOWN', borrowRequired: null,
    liquidityRequirements: [],
  });
  const reasons = validateAllocationCandidate(invalid, NOW);
  assert.ok(reasons.includes('MODE_VALIDATE_ONLY_CANNOT_RESERVE'));
  assert.ok(reasons.includes('ECONOMIC_DIRECTION_UNKNOWN'));
  assert.ok(reasons.includes('BORROW_REQUIREMENT_UNKNOWN'));
  assert.ok(reasons.includes('LIQUIDITY_REQUIREMENT_MISSING'));
  assert.equal(run([invalid]).decisions[0].status, 'BLOCKED');
});

for (const [name, snapshotOverrides, policyOverrides, expectedCode] of [
  ['gross', { grossExposureAndCommitments: '990' }, {}, 'PORTFOLIO_GROSS'],
  ['collateral', { entryCollateralAvailable: '10' }, {}, 'ENTRY_COLLATERAL'],
  ['margin', { marginHeadroomAvailable: '10' }, {}, 'MARGIN_HEADROOM'],
  ['strategy', { strategyUse: [{ key: 'BASIS', amount: '790' }] }, {}, 'STRATEGY:BASIS'],
  ['symbol', { symbolUse: [{ key: 'BTCUSDT', amount: '490' }] }, {}, 'SYMBOL:BTCUSDT'],
  ['correlation', { correlatedGroupUse: [{ key: 'BTC', amount: '590' }] }, {}, 'CORRELATED_GROUP:BTC'],
  ['venue/instrument', { venueInstrumentUse: [{ key: 'BINANCE:BTCUSDT:PAIR', amount: '490' }] }, {}, 'VENUE_INSTRUMENT:BINANCE:BTCUSDT:PAIR'],
]) {
  test(`${name} capacity caps a request deterministically`, () => {
    const decision = run([candidate(`cap-${name}`, '80')], snapshotOverrides, policyOverrides).decisions[0];
    assert.equal(decision.status, 'CAPPED');
    assert.equal(decision.grantedAmount, '10');
    assert.ok(decision.audit.some((step) => step.code === expectedCode && step.after === '10'));
  });
}

test('signed net limit applies to long and short deltas without treating missing as zero', () => {
  const long = candidate('net-long', '80', { economicDirection: 'LONG', netDirectionalExposureDelta: '80' });
  const short = candidate('net-short', '80', { economicDirection: 'SHORT', netDirectionalExposureDelta: '-80' });
  assert.equal(run([long], { grossExposureAndCommitments: '390', netDirectionalExposure: '390' }).decisions[0].grantedAmount, '10');
  assert.equal(run([short], { grossExposureAndCommitments: '390', netDirectionalExposure: '-390' }).decisions[0].grantedAmount, '10');
  assert.equal(run([long], { grossExposureAndCommitments: '390', netDirectionalExposure: '-390' }).decisions[0].grantedAmount, '80', 'risk-offsetting delta keeps full room until the opposite boundary');
});

test('borrow inventory and intended-size liquidity cap resource-consuming candidates', () => {
  const borrowing = candidate('borrow', '80', {
    borrowRequired: true, borrowRequirements: [{ key: 'BTC', amount: '80' }],
  });
  assert.equal(run([borrowing], { borrowCapacityByAsset: [{ key: 'BTC', amount: '10' }] }).decisions[0].grantedAmount, '10');
  assert.equal(run([borrowing], { borrowCapacityByAsset: [] }).decisions[0].status, 'BLOCKED');
  assert.equal(run([borrowing], { liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '20' }] }).decisions[0].grantedAmount, '20');
});

test('unopened candidates always consume plan and prospective-position capacity despite hostile false flags', () => {
  const bypassAttempt = candidate('counts', '50', { opensNewPlan: false, opensNewActivePosition: false });
  const result = run([bypassAttempt], { currentConcurrentPlans: 10, currentActivePositions: 10 });
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('CONCURRENT_PLAN_LIMIT'));
  assert.ok(result.decisions[0].blockingReasons.includes('ACTIVE_POSITION_LIMIT'));
});

test('each positive unopened allocation consumes one plan and one prospective-position slot', () => {
  const one = candidate('slot-one', '50');
  const two = candidate('eth-slot-two', '50');
  const result = run([two, one], { currentConcurrentPlans: 9, currentActivePositions: 9 });
  assert.deepEqual(result.decisions.map((entry) => entry.status), ['GRANTED', 'BLOCKED']);
  assert.equal(result.remainder.concurrentPlans, 10);
  assert.equal(result.remainder.activePositions, 10);
  assert.ok(result.decisions[1].blockingReasons.includes('CONCURRENT_PLAN_LIMIT'));
  assert.ok(result.decisions[1].blockingReasons.includes('ACTIVE_POSITION_LIMIT'));
});

test('existing reservation/order claim collision blocks the whole account context', () => {
  const commitments = [
    { id: 'reservation', capitalClaimKey: 'same', kind: 'ACTIVE_RESERVATION' },
    { id: 'order', capitalClaimKey: 'same', kind: 'OPEN_ORDER' },
  ];
  const decision = run([candidate('double-existing')], { commitments }).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.includes('CAPITAL_CLAIM_DOUBLE_COUNTED'));
});

function allocationBundle(amount = '100', options = {}) {
  const nowMs = options.nowMs ?? NOW;
  const currentTruth = options.truth ?? reservationTruth(nowMs);
  const allocationCandidate = candidate(options.key ?? `reserve-${amount}`, amount, {
    truth: currentTruth,
    ...(options.candidateOverrides ?? {}),
  });
  const allocationInput = {
    policy: policy(options.policyOverrides),
    snapshot: snapshot({ truth: currentTruth, ...(options.snapshotOverrides ?? {}) }),
    candidates: [allocationCandidate],
    nowMs,
  };
  const result = allocateCapital(allocationInput);
  return {
    allocation: result.decisions[0],
    authority: result.authorities[0],
    allocationInput,
  };
}

function reserve(book = EMPTY_RESERVATION_BOOK, overrides = {}) {
  const { bundle = allocationBundle(), ...commandOverrides } = overrides;
  return reduceReservationBook(book, {
    kind: 'RESERVE', commandId: 'reserve-command', nowMs: NOW,
    ...bundle,
    capitalClaimKey: 'claim-reserve',
    ...commandOverrides,
  });
}

function closureFor(book, reservationId, reconciledAtMs, overrides = {}) {
  const managed = book.reservations.find((entry) => entry.reservation.id === reservationId);
  assert.ok(managed, 'managed reservation must exist');
  const externalPlanId = overrides.externalPlanId ?? 'external-plan-close';
  const correlationId = overrides.correlationId ?? 'reconciliation-correlation-close';
  const reconciliationRevision = overrides.reconciliationRevision ?? 'reconciliation-r2';
  const reconciliationSequence = overrides.reconciliationSequence ?? 2;
  const mandateSemantic = {
    id: 'pending',
    revision: 1,
    considerationId: managed.reservation.considerationId,
    allocationDecisionId: managed.reservation.allocationDecisionId,
    reservationId: managed.reservation.id,
    stagedPlanId: `staged-plan:${managed.reservation.id}`,
    stagedPlanRevision: 1,
    stagedPlanDigest: capitalDigest({ plan: managed.reservation.id }),
    proposalIntakeDigest: capitalDigest({ proposal: managed.reservation.considerationId }),
    configRevision: deriveCapitalConfigRevision('allocation-closure-test', { version: 1 }),
    approvalId: null,
    riskDecision: null,
    targetMaximumExposure: managed.reservation.amount,
    valuationAsset: managed.reservation.valuationAsset,
    createdAtMs: managed.reservation.createdAtMs,
    expiresAtMs: managed.reservation.expiresAtMs,
  };
  mandateSemantic.id = deriveCapitalMandateId({
    considerationId: mandateSemantic.considerationId,
    allocationDecisionId: mandateSemantic.allocationDecisionId,
    reservationId: mandateSemantic.reservationId,
    proposalIntakeDigest: mandateSemantic.proposalIntakeDigest,
  });
  const mandate = { ...mandateSemantic, digest: capitalDigest(mandateSemantic) };
  const evidenceTruth = reservationTruth(reconciledAtMs);
  const position = projectActivePosition({
    revision: overrides.positionRevision ?? 2,
    mandateId: mandate.id,
    thesis: {
      id: `thesis:${mandate.id}`, revision: 1, strategy: 'BASIS',
      proposalId: `proposal:${mandate.considerationId}`,
      originalEvidenceIds: ['allocation-closure-evidence'], intelligenceThesisPacketId: null,
      openedAtMs: mandate.createdAtMs, expectedHorizonMs: 60_000, maximumHoldingHorizonMs: 120_000,
      targetConditions: ['closed'], invalidationConditions: ['closed'], stopAddingConditions: ['closed'],
      configRevision: mandate.configRevision,
    },
    sourceState: 'CLOSED', sourceCapitalLifecycle: 'CLOSED',
    legs: [
      {
        id: 'leg:spot', instrumentId: 'BINANCE:SPOT:BTCUSDT', symbol: 'BTCUSDT', side: 'LONG',
        quantity: '0', quoteExposure: '0', valuationAsset: mandate.valuationAsset,
        externalLifecycle: 'FILLED', truth: evidenceTruth,
      },
      {
        id: 'leg:perpetual', instrumentId: 'BINANCE:PERPETUAL:BTCUSDT', symbol: 'BTCUSDT', side: 'SHORT',
        quantity: '0', quoteExposure: '0', valuationAsset: mandate.valuationAsset,
        externalLifecycle: 'FILLED', truth: evidenceTruth,
      },
    ],
    oneLegSinceMs: null,
    executionState: {
      externalPlanId, correlationId, lifecycle: 'CLOSED', observedAtMs: reconciledAtMs,
      sequence: Math.max(0, reconciliationSequence - 1), revision: 'execution-r1', truth: evidenceTruth,
    },
    reconciliationState: {
      externalPlanId, correlationId, status: 'EXACT', observedAtMs: reconciledAtMs,
      sequence: reconciliationSequence, revision: reconciliationRevision, reasonCodes: [], truth: evidenceTruth,
    },
    outstandingActionIntentIds: [], openedAtMs: mandate.createdAtMs,
    lastTransitionAtMs: reconciledAtMs, truth: evidenceTruth, projectedAtMs: reconciledAtMs,
  }).position;
  const reboundPosition = overrides.reconciliation === undefined && overrides.remainingExposure === undefined
    ? position
    : {
      ...position,
      ...(overrides.remainingExposure === undefined ? {} : { totalGrossExposure: overrides.remainingExposure }),
      ...(overrides.reconciliation === undefined ? {} : {
        reconciliationReference: { ...position.reconciliationReference, ...overrides.reconciliation },
      }),
    };
  return {
    reservationId: managed.reservation.id,
    allocationDecisionId: managed.reservation.allocationDecisionId,
    considerationId: managed.reservation.considerationId,
    capitalClaimKey: managed.capitalClaimKey,
    reservationRevision: managed.reservation.revision,
    consumedAmount: managed.reservation.consumedAmount,
    mandate,
    position: reboundPosition,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => ![
      'externalPlanId', 'correlationId', 'reconciliationRevision', 'reconciliationSequence', 'reconciliation',
      'remainingExposure', 'positionId', 'positionRevision', 'positionState',
    ].includes(key))),
  };
}

test('reservation creation is idempotent and the same decision/claim cannot reserve twice', () => {
  const created = reserve();
  const replay = reserve(created.book);
  assert.equal(created.mutation.status, 'APPLIED');
  assert.equal(replay.mutation.status, 'IDEMPOTENT_REPLAY');
  assert.equal(replay.book, created.book);
  const mismatch = reserve(created.book, { capitalClaimKey: 'changed-claim' });
  assert.equal(mismatch.mutation.status, 'REJECTED');
  assert.ok(mismatch.mutation.reasonCodes.includes('IDEMPOTENCY_KEY_REUSE_MISMATCH'));
  const duplicateDecision = reserve(created.book, { commandId: 'reserve-again', capitalClaimKey: 'other-claim' });
  assert.ok(duplicateDecision.mutation.reasonCodes.includes('ALLOCATION_ALREADY_RESERVED'));
  const duplicateClaim = reserve(created.book, { commandId: 'reserve-other', bundle: allocationBundle('80') });
  assert.ok(duplicateClaim.mutation.reasonCodes.includes('CAPITAL_CLAIM_ALREADY_RESERVED'));
});

test('consume, renew, release, and repeated release are exact', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-1', reservationId: id, nowMs: NOW + 1, amount: '25.25' });
  assert.equal(consumed.mutation.consumedAmount, '25.25');
  assert.equal(consumed.book.reservations[0].reservation.consumedAmount, '25.25');
  const over = reduceReservationBook(consumed.book, { kind: 'CONSUME', commandId: 'consume-over', reservationId: id, nowMs: NOW + 2, amount: '75' });
  assert.equal(over.mutation.status, 'REJECTED');
  const renewed = reduceReservationBook(over.book, {
    kind: 'RENEW', commandId: 'renew', reservationId: id, nowMs: NOW + 5_000,
    policy: policy(), budgetTruth: reservationTruth(), considerationTruth: reservationTruth(),
  });
  assert.equal(renewed.book.reservations[0].reservation.expiresAtMs, NOW + 15_000);
  const released = reduceReservationBook(renewed.book, { kind: 'RELEASE', commandId: 'release', reservationId: id, nowMs: NOW + 6_000, reasonCode: 'PLAN_CANCELLED' });
  assert.equal(released.mutation.releasedAmount, '74.75');
  const again = reduceReservationBook(released.book, { kind: 'RELEASE', commandId: 'release-again', reservationId: id, nowMs: NOW + 6_001, reasonCode: 'PLAN_CANCELLED' });
  assert.equal(again.mutation.status, 'NOOP_ALREADY_TERMINAL');
  assert.equal(again.mutation.releasedAmount, '0');
});

test('TTL expiry releases unconsumed capital and cannot be renewed or consumed', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const expired = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'late-consume', reservationId: id, nowMs: NOW + 10_000, amount: '1' });
  assert.equal(expired.book.reservations[0].reservation.state, 'EXPIRED');
  assert.equal(expired.mutation.releasedAmount, '100');
  const renew = reduceReservationBook(expired.book, {
    kind: 'RENEW', commandId: 'late-renew', reservationId: id, nowMs: NOW + 10_001,
    policy: policy(), budgetTruth: reservationTruth(), considerationTruth: reservationTruth(),
  });
  assert.equal(renew.mutation.status, 'NOOP_ALREADY_TERMINAL');
});

test('close releases the full live claim exactly once', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-close', reservationId: id, nowMs: NOW + 1, amount: '60' });
  const closure = closureFor(consumed.book, id, NOW + 2);
  const closed = reduceReservationBook(consumed.book, { kind: 'CLOSE_RELEASE', commandId: 'close', reservationId: id, nowMs: NOW + 2, closure });
  assert.equal(closed.mutation.releasedAmount, '100');
  const repeated = reduceReservationBook(closed.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-other-id', reservationId: id, nowMs: NOW + 3,
    closure,
  });
  assert.equal(repeated.mutation.status, 'NOOP_ALREADY_TERMINAL');
  assert.equal(repeated.mutation.releasedAmount, '0');
});

test('release then close releases only previously consumed exposure, never the unconsumed amount twice', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume-transfer', reservationId: id, nowMs: NOW + 1, amount: '60' });
  const released = reduceReservationBook(consumed.book, { kind: 'RELEASE', commandId: 'release-rest', reservationId: id, nowMs: NOW + 2, reasonCode: 'FUTURE_STAGES_CANCELLED' });
  assert.equal(released.mutation.releasedAmount, '40');
  const closed = reduceReservationBook(released.book, {
    kind: 'CLOSE_RELEASE', commandId: 'position-closed', reservationId: id, nowMs: NOW + 3,
    closure: closureFor(released.book, id, NOW + 3, {
      positionRevision: 3,
      externalPlanId: 'external-plan-transfer', reconciliationRevision: 'reconciliation-r3',
    }),
  });
  assert.equal(closed.mutation.releasedAmount, '60');
});

test('blocked allocation and invalid TTL cannot create a reservation', () => {
  const blockedBundle = allocationBundle('100', {
    key: 'blocked-reserve',
    snapshotOverrides: { entryCollateralAvailable: '0' },
    policyOverrides: { reservationTtlMs: integerBound(20_001, 20_000, 'MILLISECONDS') },
  });
  const result = reserve(EMPTY_RESERVATION_BOOK, {
    bundle: blockedBundle,
  });
  assert.equal(result.book.reservations.length, 0);
  assert.ok(result.mutation.reasonCodes.includes('ALLOCATION_NOT_GRANTING'));
  assert.ok(result.mutation.reasonCodes.includes('RESERVATION_TTL_BOUND_INVALID'));
});

test('allocation re-ages candidate and budget truth instead of trusting cached FRESH labels', () => {
  const staleNow = NOW + 1_001;
  const result = allocateCapital({ policy: policy(), snapshot: snapshot(), candidates: [candidate('stale-replay')], nowMs: staleNow });
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.ok(result.decisions[0].blockingReasons.includes('SNAPSHOT_TRUTH_STALE'));
  assert.ok(result.decisions[0].blockingReasons.includes('CONSIDERATION_TRUTH_STALE'));
});

test('zero resource requirements cannot convert known zero capacity into a full grant', () => {
  const zero = candidate('zero-capacity', '100', {
    borrowRequired: true,
    strategyRequirements: [{ key: 'BASIS', amount: '0' }],
    symbolRequirements: [{ key: 'BTCUSDT', amount: '0' }],
    correlatedGroupRequirements: [{ key: 'BTC', amount: '0' }],
    venueInstrumentRequirements: [{ key: 'BINANCE:BTCUSDT:PAIR', amount: '0' }],
    borrowRequirements: [{ key: 'BTC', amount: '0' }],
    liquidityRequirements: [{ key: 'BTC:SPOT', amount: '0' }],
  });
  const decision = run([zero], {
    borrowCapacityByAsset: [{ key: 'BTC', amount: '0' }],
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '0' }],
  }).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.some((reason) => reason.endsWith('_AMOUNT_INVALID')));
});

test('one consideration cannot gain two active reservations across allocation clocks or caller claim keys', () => {
  const firstBundle = allocationBundle('100', { key: 'repeat-consideration' });
  const first = reserve(EMPTY_RESERVATION_BOOK, { bundle: firstBundle, capitalClaimKey: 'claim-one' });
  assert.equal(first.mutation.status, 'APPLIED');

  const secondNow = NOW + 1;
  const secondTruth = reservationTruth(secondNow);
  const secondBundle = allocationBundle('100', { key: 'repeat-consideration', nowMs: secondNow, truth: secondTruth });
  assert.notEqual(secondBundle.allocation.id, firstBundle.allocation.id);
  const second = reduceReservationBook(first.book, {
    kind: 'RESERVE', commandId: 'reserve-second-clock', nowMs: secondNow,
    ...secondBundle, capitalClaimKey: 'claim-two',
  });
  assert.equal(second.mutation.status, 'REJECTED');
  assert.ok(second.mutation.reasonCodes.includes('CONSIDERATION_ALREADY_RESERVED'));
  assert.equal(second.book.reservations.length, 1);
});

test('reservation commands are monotonic and allocation authority expires with its evidence', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const backdated = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'backdated-consume', reservationId: id, nowMs: NOW - 1, amount: '1',
  });
  assert.equal(backdated.mutation.status, 'REJECTED');
  assert.ok(backdated.mutation.reasonCodes.includes('COMMAND_TIME_NOT_MONOTONIC'));

  const stale = reserve(EMPTY_RESERVATION_BOOK, {
    commandId: 'stale-decision-reserve',
    nowMs: NOW + 100_001,
  });
  assert.equal(stale.mutation.status, 'REJECTED');
  assert.ok(stale.mutation.reasonCodes.includes('BUDGET_TRUTH_NOT_CURRENT'));

});

test('fresh raw truth may be re-aged by allocation without requiring evaluatedAt equality', () => {
  const rawTruth = reservationTruth(NOW);
  const decidedAtMs = NOW + 500;
  const bundle = allocationBundle('100', { key: 're-aged-reserve', nowMs: decidedAtMs, truth: rawTruth });
  assert.equal(bundle.allocation.status, 'GRANTED');
  const rebound = reserve(EMPTY_RESERVATION_BOOK, {
    bundle, commandId: 're-aged-truth-reserve', nowMs: decidedAtMs,
  });
  assert.equal(rebound.mutation.status, 'APPLIED');
});

test('consumed capital needs exact closed-position and matched-reconciliation proof before release', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'consume-for-proof', reservationId: id, nowMs: NOW + 1, amount: '60',
  });
  const rejected = reduceReservationBook(consumed.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-without-zero', reservationId: id, nowMs: NOW + 2,
    closure: closureFor(consumed.book, id, NOW + 2, {
      positionId: 'position-live', externalPlanId: 'external-plan-live', remainingExposure: '0.1',
    }),
  });
  assert.equal(rejected.mutation.status, 'REJECTED');
  assert.ok(rejected.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED'));
  assert.equal(rejected.book.reservations[0].closedExposureReleased, false);
});

test('caller-recomputed decision and receipt digests cannot forge allocator authority', () => {
  const bundle = allocationBundle();
  const forgedAmount = '1000000';
  const forged = {
    ...bundle.allocation,
    id: deriveAllocationDecisionId({
      considerationId: bundle.allocation.considerationId,
      policyRevision: bundle.allocation.policyRevision,
      nowMs: bundle.allocation.decidedAtMs,
      grant: forgedAmount,
    }),
    status: 'GRANTED',
    requestedAmount: forgedAmount,
    grantedAmount: forgedAmount,
  };
  const { digest: _digest, ...authoritySemantic } = bundle.authority;
  const forgedAuthoritySemantic = {
    ...authoritySemantic,
    allocationDecisionId: forged.id,
    decisionDigest: capitalDigest(forged),
  };
  const forgedAuthority = {
    ...forgedAuthoritySemantic,
    digest: capitalDigest(forgedAuthoritySemantic),
  };
  const result = reserve(EMPTY_RESERVATION_BOOK, {
    commandId: 'forged-allocation-reserve',
    allocation: forged,
    authority: forgedAuthority,
    allocationInput: bundle.allocationInput,
  });
  assert.equal(result.mutation.status, 'REJECTED');
  assert.ok(result.mutation.reasonCodes.includes('ALLOCATOR_AUTHORITY_RECEIPT_MISMATCH'));
  assert.equal(result.book.reservations.length, 0);
});

test('a full self-replayed bundle cannot widen policy limits under a retained revision', () => {
  const honestPolicy = policy();
  const wide = bound('1000000');
  const inflatedPolicy = {
    ...honestPolicy,
    portfolioGrossLimit: wide,
    portfolioNetLimit: wide,
    perStrategyLimits: { BASIS: wide, VOLUME: wide },
    perSymbolLimit: wide,
    perCorrelatedGroupLimit: wide,
    perVenueInstrumentLimit: wide,
  };
  const currentTruth = reservationTruth();
  const allocationInput = {
    policy: inflatedPolicy,
    snapshot: snapshot({
      truth: currentTruth,
      entryCollateralAvailable: '1000000',
      protectedRiskReductionReserve: '100',
      marginHeadroomAvailable: '1000000',
      borrowCapacityByAsset: [{ key: 'BTC', amount: '1000000' }],
      liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: '1000000' }],
    }),
    candidates: [candidate('same-revision-policy-inflation', '1000000', { truth: currentTruth })],
    nowMs: NOW,
  };
  const selfIssued = allocateCapital(allocationInput);
  assert.equal(selfIssued.decisions[0].status, 'BLOCKED');
  assert.ok(selfIssued.decisions[0].blockingReasons.includes('POLICY_REVISION_CONTENT_MISMATCH'));

  const reserved = reduceReservationBook(EMPTY_RESERVATION_BOOK, {
    kind: 'RESERVE', commandId: 'same-revision-policy-inflation', nowMs: NOW,
    allocation: selfIssued.decisions[0], authority: selfIssued.authorities[0], allocationInput,
    capitalClaimKey: 'inflated-claim',
  });
  assert.equal(reserved.mutation.status, 'REJECTED');
  assert.ok(reserved.mutation.reasonCodes.includes('POLICY_REVISION_CONTENT_MISMATCH'));
  assert.equal(reserved.book.reservations.length, 0);
});

test('closure proof is bound to the latest reservation revision, consumption, consideration, and claim', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const proofBeforeConsume = closureFor(created.book, id, NOW);
  const consumed = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'consume-after-proof', reservationId: id, nowMs: NOW + 1, amount: '60',
  });
  const staleProof = reduceReservationBook(consumed.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-with-pre-consume-proof', reservationId: id, nowMs: NOW + 2,
    closure: proofBeforeConsume,
  });
  assert.equal(staleProof.mutation.status, 'REJECTED');
  assert.equal(staleProof.mutation.releasedAmount, '0');

  const unrelatedProof = reduceReservationBook(staleProof.book, {
    kind: 'CLOSE_RELEASE', commandId: 'close-with-unrelated-proof', reservationId: id, nowMs: NOW + 2,
    closure: closureFor(staleProof.book, id, NOW + 2, { capitalClaimKey: 'different-claim' }),
  });
  assert.equal(unrelatedProof.mutation.status, 'REJECTED');
  assert.equal(unrelatedProof.book.reservations.find((entry) => entry.reservation.id === id).closedExposureReleased, false);
});

test('closure consumes only a canonical Foundation EXACT reconciliation reference', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const consumed = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'consume-canonical-reconciliation', reservationId: id, nowMs: NOW + 1, amount: '60',
  });
  const exactClosure = closureFor(consumed.book, id, NOW + 2);
  const { mandate: _mandate, position: _position, ...closureWithoutProof } = exactClosure;
  const reconciliation = exactClosure.position.reconciliationReference;
  const legacyMatched = reduceReservationBook(consumed.book, {
    kind: 'CLOSE_RELEASE', commandId: 'legacy-matched-reconciliation', reservationId: id, nowMs: NOW + 2,
    closure: {
      ...closureWithoutProof,
      positionId: exactClosure.position.id,
      positionRevision: exactClosure.position.revision,
      positionState: 'CLOSED',
      reconciliationId: reconciliation.id,
      reconciliationRevision: reconciliation.revision,
      reconciliationState: 'MATCHED',
      reconciledAtMs: NOW + 2,
      remainingExposure: '0',
    },
  });
  assert.equal(legacyMatched.mutation.status, 'REJECTED');

  const divergent = reduceReservationBook(legacyMatched.book, {
    kind: 'CLOSE_RELEASE', commandId: 'divergent-reconciliation', reservationId: id, nowMs: NOW + 2,
    closure: {
      ...exactClosure,
      position: {
        ...exactClosure.position,
        reconciliationReference: { ...reconciliation, status: 'DIVERGED' },
      },
    },
  });
  assert.equal(divergent.mutation.status, 'REJECTED');

  const forgedReference = reduceReservationBook(divergent.book, {
    kind: 'CLOSE_RELEASE', commandId: 'forged-reconciliation-reference', reservationId: id, nowMs: NOW + 2,
    closure: {
      ...exactClosure,
      position: {
        ...exactClosure.position,
        reconciliationReference: { ...reconciliation, id: 'crecon_forged' },
      },
    },
  });
  assert.equal(forgedReference.mutation.status, 'REJECTED');
  assert.ok([legacyMatched, divergent, forgedReference].every((entry) => (
    entry.mutation.reasonCodes.includes('CLOSURE_RECONCILIATION_PROOF_REQUIRED')
    && entry.mutation.releasedAmount === '0'
  )));
  assert.equal(forgedReference.book.reservations[0].closedExposureReleased, false);
});

test('unknown runtime command kinds reject explicitly and cannot fall through to release', () => {
  const created = reserve();
  const id = created.mutation.reservationId;
  const result = reduceReservationBook(created.book, {
    kind: 'BOGUS', commandId: 'bogus-release', reservationId: id, nowMs: NOW + 1, reasonCode: 'SHOULD_NOT_RELEASE',
  });
  assert.equal(result.mutation.status, 'REJECTED');
  assert.equal(result.mutation.commandKind, 'UNKNOWN');
  assert.ok(result.mutation.reasonCodes.includes('COMMAND_KIND_UNKNOWN'));
  assert.equal(result.book.reservations.find((entry) => entry.reservation.id === id).reservation.state, 'ACTIVE');
});

test('a fresh reservation atomically expires and replaces an unconsumed expired claim', () => {
  const firstBundle = allocationBundle('100', { key: 'replace-expired' });
  const first = reserve(EMPTY_RESERVATION_BOOK, { bundle: firstBundle, capitalClaimKey: 'replace-claim' });
  const firstId = first.mutation.reservationId;
  const secondNow = NOW + 10_000;
  const secondBundle = allocationBundle('100', {
    key: 'replace-expired', nowMs: secondNow, truth: reservationTruth(secondNow),
  });
  const invalid = reserve(first.book, {
    bundle: secondBundle, commandId: 'invalid-replacement', nowMs: secondNow, capitalClaimKey: '',
  });
  assert.equal(invalid.mutation.status, 'REJECTED');
  assert.equal(invalid.book.reservations.find((entry) => entry.reservation.id === firstId).reservation.state, 'ACTIVE');
  assert.ok(!invalid.book.mutations.some((entry) => entry.reasonCodes.includes('RESERVATION_EXPIRED_BEFORE_RESERVE')));

  const second = reserve(invalid.book, {
    bundle: secondBundle, commandId: 'reserve-replacement', nowMs: secondNow, capitalClaimKey: 'replace-claim',
  });
  assert.equal(second.mutation.status, 'APPLIED');
  assert.equal(second.book.reservations.find((entry) => entry.reservation.id === firstId).reservation.state, 'EXPIRED');
  assert.equal(second.book.reservations.find((entry) => entry.reservation.id === second.mutation.reservationId).reservation.state, 'ACTIVE');
  assert.ok(second.book.mutations.some((entry) => entry.commandKind === 'EXPIRE'
    && entry.reasonCodes.includes('RESERVATION_EXPIRED_BEFORE_RESERVE')));
});

test('a rejected far-future RESERVE records only its rejection and never sweeps reservation state', () => {
  const created = reserve();
  const managedBefore = created.book.reservations[0];
  const futureNow = NOW + 90_000;
  const futureBundle = allocationBundle('100', {
    key: 'rejected-future-reserve', nowMs: futureNow, truth: reservationTruth(futureNow),
  });
  const rejected = reserve(created.book, {
    bundle: futureBundle,
    commandId: 'rejected-future-reserve',
    nowMs: futureNow,
    capitalClaimKey: '',
  });
  assert.equal(rejected.mutation.status, 'REJECTED');
  assert.ok(rejected.mutation.reasonCodes.includes('CAPITAL_CLAIM_KEY_INVALID'));
  assert.equal(rejected.book.mutations.length, created.book.mutations.length + 1);
  assert.strictEqual(rejected.book.reservations[0], managedBefore);
  assert.equal(rejected.book.reservations[0].reservation.state, 'ACTIVE');
  assert.ok(!rejected.book.mutations.slice(created.book.mutations.length)
    .some((entry) => entry.reasonCodes.includes('RESERVATION_EXPIRED_BEFORE_RESERVE')));
});

test('sub-quantum proportional capacity fails closed instead of overconsuming exact inventory', () => {
  const microCapacity = '0.00000000000000000000000075';
  const constrained = candidate('sub-quantum', '1', {
    borrowRequired: true,
    borrowRequirements: [{ key: 'BTC', amount: '1' }],
  });
  const result = run([constrained], { borrowCapacityByAsset: [{ key: 'BTC', amount: microCapacity }] });
  assert.equal(result.decisions[0].status, 'BLOCKED');
  assert.equal(result.decisions[0].grantedAmount, '0');
  assert.equal(result.remainder.borrowCapacityByAsset[0].amount, microCapacity);
});

test('caller priority and locale labels cannot self-promote over canonical consideration identity', () => {
  const one = candidate('priority-one', '70');
  const two = candidate('eth-priority-two', '70');
  const [canonicalFirst, canonicalSecond] = [one, two]
    .sort((left, right) => left.considerationId < right.considerationId ? -1 : 1);
  const demotedFirst = { ...canonicalFirst, priority: { policyClass: -1, stableKey: 'ä' } };
  const promotedSecond = { ...canonicalSecond, priority: { policyClass: Number.MAX_SAFE_INTEGER, stableKey: '' } };
  const first = run([promotedSecond, demotedFirst], { entryCollateralAvailable: '100' });
  const second = run([demotedFirst, promotedSecond], { entryCollateralAvailable: '100' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.decisions.map((entry) => [entry.considerationId, entry.grantedAmount, entry.priorityKey]), [
    [canonicalFirst.considerationId, '70', canonicalFirst.considerationId],
    [canonicalSecond.considerationId, '30', canonicalSecond.considerationId],
  ]);
});

test('allocation and reservation clocks reject safe integers outside Foundation UTC range', () => {
  const outsideUtc = MAX_UTC_MS + 1;
  assert.ok(validateAllocationCandidate(candidate('outside-utc'), outsideUtc).includes('NOW_INVALID'));

  const created = reserve();
  const rejected = reduceReservationBook(created.book, {
    kind: 'CONSUME', commandId: 'outside-utc-consume', reservationId: created.mutation.reservationId,
    nowMs: outsideUtc, amount: '1',
  });
  assert.equal(rejected.mutation.status, 'REJECTED');
  assert.ok(rejected.mutation.reasonCodes.includes('COMMAND_INVALID'));
  assert.equal(rejected.mutation.appliedAtMs, 0);
  assert.strictEqual(rejected.book.reservations[0], created.book.reservations[0]);
});

test('malformed signed net input returns a typed block instead of throwing', () => {
  const malformed = candidate('malformed-net', '50', {
    economicDirection: 'LONG', netDirectionalExposureDelta: 'not-a-decimal',
  });
  assert.doesNotThrow(() => run([malformed]));
  assert.ok(run([malformed]).decisions[0].blockingReasons.includes('NET_DELTA_INVALID'));
});

test('full upstream consideration blocks an advisory Volume self-upgrade even with a recomputed sizing revision', () => {
  const advisoryVolume = candidate('advisory-volume-upgrade', '100', {
    strategy: 'VOLUME', eligibilityStatus: 'ADVISORY', considerationMode: 'ADVISORY',
  });
  const promoted = reissueSizing({
    ...advisoryVolume,
    eligibilityStatus: 'ELIGIBLE',
    considerationMode: 'MANUAL_ARMED',
    strategy: 'BASIS',
    strategyRequirements: [{ key: 'BASIS', amount: '100' }],
  });
  const decision = run([promoted]).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.includes('CONSIDERATION_STRATEGY_NOT_CAPITAL_AUTHORIZED'));
  assert.ok(decision.blockingReasons.includes('CONSIDERATION_STRATEGY_BINDING_MISMATCH'));
});

test('optional unknown evidence does not override an eligible complete consideration', () => {
  const base = candidate('optional-evidence-unknown', '50');
  const consideration = { ...base.consideration, evidenceTruth: 'UNKNOWN' };
  const eligible = reissueSizing({
    ...base,
    consideration,
    considerationDigest: capitalDigest(consideration),
  });
  assert.deepEqual(validateAllocationCandidate(eligible, NOW), []);
  const decision = run([eligible]).decisions[0];
  assert.equal(decision.status, 'GRANTED');
  assert.equal(decision.grantedAmount, '50');
});

test('a 100-unit request with self-reported 1-unit resources cannot receive any grant', () => {
  const underreported = candidate('underreported-sizing', '100', {
    grossExposureIncrease: '1', collateralRequired: '1', marginRequired: '1',
    strategyRequirements: [{ key: 'BASIS', amount: '1' }],
    symbolRequirements: [{ key: 'BTCUSDT', amount: '1' }],
    correlatedGroupRequirements: [{ key: 'BTC', amount: '1' }],
    venueInstrumentRequirements: [{ key: 'BINANCE:BTCUSDT:PAIR', amount: '1' }],
    liquidityRequirements: [{ key: 'BTC:SPOT', amount: '1' }],
  });
  assert.equal(underreported.sizingAuthority.revision, deriveAllocationSizingAuthorityRevision(underreported));
  const decision = run([underreported]).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.grantedAmount, '0');
  assert.ok(decision.blockingReasons.includes('GROSS_UNDERSTATES_REQUEST'));
  assert.ok(decision.blockingReasons.includes('COLLATERAL_MUST_EQUAL_REQUEST'));
  assert.ok(decision.blockingReasons.includes('LIQUIDITY_REQUIREMENT_UNDERSTATES_REQUEST'));
});

test('retained sizing revisions reject widened requests and weakened resource geometry', () => {
  const honest = candidate('retained-sizing-revision', '80');
  const widened = { ...honest, requestedAmount: '100' };
  const weakened = { ...honest, liquidityRequirements: [{ key: 'BTC:SPOT', amount: '1' }] };
  assert.notEqual(widened.sizingAuthority.revision, deriveAllocationSizingAuthorityRevision(widened));
  assert.notEqual(weakened.sizingAuthority.revision, deriveAllocationSizingAuthorityRevision(weakened));
  for (const hostile of [widened, weakened]) {
    const decision = run([hostile]).decisions[0];
    assert.equal(decision.status, 'BLOCKED');
    assert.ok(decision.blockingReasons.includes('SIZING_AUTHORITY_REVISION_MISMATCH'));
  }
});

test('normal and reverse Basis leg geometry both derive HEDGED independent of proposal direction labels', () => {
  const normal = candidate('normal-basis-direction', '50');
  assert.equal(normal.consideration.proposal.direction, 'long_spot_short_perp');
  assert.ok(!validateAllocationCandidate(normal, NOW).includes('CONSIDERATION_DIRECTION_BINDING_MISMATCH'));

  const reverseConsideration = {
    ...normal.consideration,
    proposal: { ...normal.consideration.proposal, direction: 'short_spot_long_perp' },
    legs: normal.consideration.legs.map((leg) => ({
      ...leg,
      side: leg.role === 'SPOT' ? 'SHORT' : 'LONG',
    })),
  };
  const reverse = reissueSizing({
    ...normal,
    consideration: reverseConsideration,
    considerationDigest: capitalDigest(reverseConsideration),
  });
  assert.ok(!validateAllocationCandidate(reverse, NOW).includes('CONSIDERATION_DIRECTION_BINDING_MISMATCH'));
  assert.equal(run([normal]).decisions[0].status, 'GRANTED');
  assert.equal(run([reverse]).decisions[0].status, 'GRANTED');
});

test('net exposure magnitude cannot exceed gross exposure', () => {
  const impossible = candidate('net-greater-than-gross', '50', {
    economicDirection: 'LONG', netDirectionalExposureDelta: '60',
  });
  const decision = run([impossible]).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.includes('NET_DELTA_EXCEEDS_GROSS'));
});

test('case and padding aliases in allocation identifiers fail closed', () => {
  const lowerCaseSymbol = candidate('lowercase-symbol', '50', { primarySymbol: 'btcusdt' });
  const paddedResource = candidate('padded-resource', '50', {
    correlatedGroupRequirements: [{ key: 'BTC ', amount: '50' }],
  });
  const lowerDecision = run([lowerCaseSymbol]).decisions[0];
  const paddedDecision = run([paddedResource]).decisions[0];
  assert.equal(lowerDecision.status, 'BLOCKED');
  assert.ok(lowerDecision.blockingReasons.includes('PRIMARY_SYMBOL_NOT_CANONICAL'));
  assert.equal(paddedDecision.status, 'BLOCKED');
  assert.ok(paddedDecision.blockingReasons.includes('CORRELATED_GROUP_REQUIREMENT_KEY_NOT_CANONICAL'));
});

test('malformed consideration truth returns a typed fail-closed decision', () => {
  const validTruth = truth();
  const malformedTruth = {
    ...validTruth,
    source: { ...validTruth.source, sourceTimeMs: 'not-utc-milliseconds' },
  };
  const malformed = candidate('malformed-consideration-truth', '50', { truth: malformedTruth });
  assert.doesNotThrow(() => validateAllocationCandidate(malformed, NOW));
  assert.doesNotThrow(() => run([malformed]));
  const decision = run([malformed]).decisions[0];
  assert.equal(decision.status, 'BLOCKED');
  assert.ok(decision.blockingReasons.includes('CONSIDERATION_TRUTH_UNKNOWN'));
});

test('an exact 1e-95 allocation grants without overflowing an intermediate product', () => {
  const tiny = `0.${'0'.repeat(94)}1`;
  const tinyBound = bound(tiny);
  const micro = candidate('tiny-exact-allocation', tiny);
  const result = run([micro], {
    entryCollateralAvailable: tiny,
    protectedRiskReductionReserve: '0',
    marginHeadroomAvailable: tiny,
    liquidityCapacityByKey: [{ key: 'BTC:SPOT', amount: tiny }],
  }, {
    portfolioGrossLimit: tinyBound,
    portfolioNetLimit: tinyBound,
    perStrategyLimits: { BASIS: tinyBound, VOLUME: tinyBound },
    perSymbolLimit: tinyBound,
    perCorrelatedGroupLimit: tinyBound,
    perVenueInstrumentLimit: tinyBound,
    riskReductionReserve: bound('0'),
  });
  assert.equal(result.decisions[0].status, 'GRANTED');
  assert.equal(result.decisions[0].grantedAmount, tiny);
  assert.equal(result.remainder.grossExposureAndCommitments, tiny);
});
