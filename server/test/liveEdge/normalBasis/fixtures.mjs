import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  canonicalJson,
  deriveEventId,
  stableHash128Hex,
  stableHash64Hex,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionPlanDefinition,
} from '../../../dist/foundation/execution/index.js';
import { evaluateMultiLegRisk } from '../../../dist/foundation/risk/index.js';
import { createReplayHarness, basisConfig } from '../../../dist/engine/basis/index.js';
import {
  captureEngineSnapshot,
  buildCanonicalReadModelFromCaptures,
} from '../../../dist/systemIntegration/adapters/index.js';
import {
  capitalDigest,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  EMPTY_RESERVATION_BOOK,
  reduceReservationBook,
} from '../../../dist/capitalFoundation/allocation/index.js';
import {
  buildCapitalMandate,
  buildStagedPlan,
  createStagedPlanConfiguration,
} from '../../../dist/capitalFoundation/stages/index.js';
import {
  constructUnsignedRequest,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/request.js';
import {
  bindSpotOrderTifCapability,
  deriveSpotOrderTifDependencyRevision,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  multiplyTwinDecimals,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
  bindNormalBasisFoundationPlan,
  evaluateNormalBasisEntryBinding,
  runNormalBasisTwinLeg,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  makeAction,
  makeCandidate,
  makeExecutionPolicyInput,
  makeScenario,
} from '../executionPolicy/fixtures.mjs';
import {
  T0 as TWIN_T0,
  baselineEvents,
  event,
  orderByFixtureId,
  orderFixture,
  passingPreflight,
  scenarioInput,
} from '../exchangeTwin/fixtures.mjs';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';
import { buildL05SpotOwnerEvidence } from '../mutationJournal/l05-owner-fixture.mjs';
import {
  allocationCandidate,
  allocationFor,
  budgetPolicy,
  budgetSnapshot,
  eligibilityPolicy,
  evaluateSeeds,
  proposalSeed,
  truth as capitalTruth,
} from '../../capitalFoundation/scenarios/fixtures.mjs';
import { buildNormalBasisL05Projection } from './l05-fixture.mjs';
import { allowedRiskInput } from '../../foundation/fixtures/compatibility-fixtures.mjs';

export { TWIN_T0 };
export const VENUE_ARRIVAL_MS = TWIN_T0 + 20;
const PRIVATE_EVIDENCE_AT_MS = L06_T0 - 50;

let fixtureCounter = 0;
const ownerChainCache = new Map();

function deepFreeze(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export class ManualClock {
  constructor(nowMs = VENUE_ARRIVAL_MS) { this.value = nowMs; }
  nowMs() { return this.value; }
  set(nowMs) { this.value = nowMs; }
  advance(deltaMs) { this.value += deltaMs; }
}

function spotPolicyLeg(capability) {
  return {
    legId: 'leg-spot',
    instrumentRevision: capability.instrumentRevision,
    filterRevision: capability.registryRevision,
    l04SizingRevision: capability.preflightRevision,
    l04SourceEvidenceRevision: capability.sourceEvidenceRevision,
    l04SnapshotRevision: capability.snapshotRevision,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: ['GTC'],
    product: 'SPOT',
    accountRealmId: 'realm-normal-basis-spot',
    symbol: capability.symbol,
    baseAsset: capability.baseAsset,
    quoteAsset: capability.quoteAsset,
    side: 'BUY',
    reduceOnly: false,
    requestedQuantity: capability.requestedQuantity,
    filteredQuantity: capability.resultQuantity,
    authorizedLimitPrice: capability.requestedPrice,
    filteredNotionalQuote: capability.resultNotional,
  };
}

function perpPolicyLeg(result) {
  assert.equal(result.staticState, 'PASS', result.reasonCodes.join(','));
  return {
    legId: 'leg-perp',
    instrumentRevision: result.instrumentRevision,
    filterRevision: result.registryRevision,
    l04SizingRevision: `l04-perp-sizing:${result.snapshotRevision}`,
    l04SourceEvidenceRevision: result.sourceEvidenceRevision,
    l04SnapshotRevision: result.snapshotRevision,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: ['GTC'],
    product: 'USD_M_PERPETUAL',
    accountRealmId: 'realm-normal-basis-perp',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    side: 'SELL',
    reduceOnly: false,
    requestedQuantity: result.requestedQuantity,
    filteredQuantity: result.resultQuantity,
    authorizedLimitPrice: result.requestedPrice,
    filteredNotionalQuote: result.resultNotional,
  };
}

function basisMarketStep(atMs) {
  const spotBid = 100;
  const spotAsk = 100.02;
  const perpBid = spotAsk * 1.0078;
  const perpAsk = perpBid + 0.02;
  return {
    atMs,
    events: [
      { type: 'spotBook', tick: { symbol: 'BTCUSDT', bid: spotBid, ask: spotAsk, bidQty: 500, askQty: 500, ts: atMs } },
      { type: 'perpBook', tick: { symbol: 'BTCUSDT', bid: perpBid, ask: perpAsk, bidQty: 500, askQty: 500, ts: atMs } },
      {
        type: 'markFunding',
        tick: {
          symbol: 'BTCUSDT', markPrice: (perpBid + perpAsk) / 2, fundingRate: 0.0001,
          nextFundingTs: atMs + (4 * 3_600_000), ts: atMs,
        },
      },
      { type: 'spotDepth', ladder: { symbol: 'BTCUSDT', bids: [[spotBid, 500]], asks: [[spotAsk, 500]], ts: atMs } },
      { type: 'perpDepth', ladder: { symbol: 'BTCUSDT', bids: [[perpBid, 500]], asks: [[perpAsk, 500]], ts: atMs } },
    ],
  };
}

function capitalStage(stage, sequence, amounts, nextStage) {
  const increasing = stage === 'CONFIRM' || stage === 'ADD';
  return {
    stage,
    sequence,
    maximumAdditionalExposure: amounts[0],
    maximumTotalExposure: amounts[1],
    reservationConsumption: amounts[2],
    prerequisites: increasing
      ? [{ code: `${stage}_EVIDENCE`, required: true, evidenceMaximumAgeMs: 1_000, detail: 'owner evidence' }]
      : [],
    economicThesisConditions: increasing ? [`${stage}_THESIS`] : [],
    invalidationConditions: increasing ? [`${stage}_INVALID`] : [],
    maximumTimeInStageMs: 10_000,
    requiredApprovalActions: stage === 'CONFIRM' ? ['OPEN'] : stage === 'ADD' ? ['ADD'] : [],
    requiredFutureGates: increasing
      ? ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE']
      : [],
    liquidityRequirement: increasing ? '10' : null,
    maximumNakedLegAmount: increasing ? '10' : '0',
    maximumNakedLegDurationMs: increasing ? 1_000 : 0,
    stopAddingConditions: increasing ? [`${stage}_STOP`] : [],
    allowedNextStages: nextStage === null ? [] : [nextStage],
    reductionConditions: stage === 'REDUCE' ? ['REDUCE_REQUIRED'] : [],
    cancellableBeforeEntry: true,
    nextStageConditions: nextStage === null
      ? [] : [{ targetStage: nextStage, conditions: [`${stage}_TO_${nextStage}`] }],
    skipConditions: stage === 'OBSERVE'
      ? [{ targetStage: 'CONFIRM', skippedStages: ['PROBE'], conditions: ['PROBE_NOT_REQUIRED'] }]
      : [],
    unenteredCancellationConditions: ['PROPOSAL_EXPIRED'],
  };
}

function timeAlignedRiskInput(ownerPlan, canonicalProposal) {
  const source = allowedRiskInput(ownerPlan, canonicalProposal);
  const deltaMs = VENUE_ARRIVAL_MS - source.nowMs;
  const shift = (value) => {
    if (Array.isArray(value)) return value.map(shift);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shift(entry)]));
    }
    return typeof value === 'number' && value > 1_700_000_000_000 && value < 1_900_000_000_000
      ? value + deltaMs : value;
  };
  const input = shift(source);
  const dayMs = 86_400_000;
  const dayStartMs = Math.floor(VENUE_ARRIVAL_MS / dayMs) * dayMs;
  input.nowMs = VENUE_ARRIVAL_MS;
  input.account.dailyPeriodStartMs = dayStartMs;
  input.account.dailyPeriodEndMs = dayStartMs + dayMs;
  return input;
}

function buildNormalBasisOwnerChain(suffix) {
  const cached = ownerChainCache.get(suffix);
  if (cached !== undefined) return cached;
  const timeOffsetMs = Number.parseInt(stableHash64Hex(suffix).slice(0, 6), 16) % 1_000;
  const replayStartMs = VENUE_ARRIVAL_MS - 8_000 - timeOffsetMs;
  const resolvedConfig = basisConfig({ persistTicks: 3 });
  const harness = createReplayHarness(resolvedConfig, replayStartMs);
  const replay = harness.run([
    {
      atMs: replayStartMs,
      tick: false,
      events: [{
        type: 'universe',
        symbols: [{
          symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', hasSpot: true, hasPerp: true,
          marginBorrowable: null, minNotionalUsd: 5, tickSize: 0.01, stepSize: 0.001,
          quoteVolume24hUsd: 50_000_000, eligible: true, ineligibleReason: null,
        }],
      }],
    },
    basisMarketStep(replayStartMs + 2_000),
    basisMarketStep(replayStartMs + 4_000),
    basisMarketStep(replayStartMs + 6_000),
  ]);
  const sourceProposal = harness.engine.proposals.open()[0];
  assert.ok(sourceProposal, 'Basis owner did not emit an open proposal');
  const configRevision = `basis-config:${stableHash128Hex(canonicalJson(resolvedConfig))}`;
  const decisionOwnerId = (record) => (
    `${record.correlationId}|${record.symbol}|${record.ts}|${record.kind}`
  );
  const capture = captureEngineSnapshot({
    family: 'BASIS',
    sourceId: `basis.engine.replay.${sourceProposal.id}`,
    snapshotTimeMs: harness.clock.now(),
    receivedAtMs: harness.clock.now(),
    maxAgeMs: 30_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: configRevision,
    correlationId: sourceProposal.correlationId,
    recordLimit: 100,
    port: {
      readDecisions: () => replay.decisions,
      readProposals: () => harness.engine.proposals.all(),
      readRecordRevision: (kind, ownerId) => {
        const record = kind === 'PROPOSAL'
          ? harness.engine.proposals.all().find((candidate) => candidate.id === ownerId)
          : replay.decisions.find((candidate) => decisionOwnerId(candidate) === ownerId);
        return record === undefined
          ? null : `${kind.toLowerCase()}-revision:${stableHash128Hex(canonicalJson(record))}`;
      },
    },
  });
  assert.equal(capture.ok, true, JSON.stringify(capture));
  const canonical = buildCanonicalReadModelFromCaptures({
    nowMs: VENUE_ARRIVAL_MS,
    correlationId: sourceProposal.correlationId,
    basis: capture.value,
    volume: null,
    safeCurrentState: 'ADVISORY',
  });
  assert.equal(canonical.ok, true, JSON.stringify(canonical));
  const canonicalProposal = canonical.value.view.basis.proposals.find(
    (candidate) => candidate.sourceId === sourceProposal.id,
  );
  assert.ok(canonicalProposal, 'canonical Basis proposal projection is absent');
  const proposalAlias = canonical.value.identities.find(
    (candidate) => candidate.ownerId === sourceProposal.id,
  );
  const proposalDecision = replay.decisions.find((candidate) => candidate.kind === 'proposal');
  assert.ok(proposalDecision, 'Basis proposal decision is absent');
  const decisionAlias = canonical.value.identities.find(
    (candidate) => candidate.ownerId === decisionOwnerId(proposalDecision),
  );
  assert.ok(proposalAlias && decisionAlias, 'canonical Basis identity aliases are absent');

  const ownerTruth = (label) => capitalTruth(`${sourceProposal.id}.${label}`, {
    source: {
      sourceTimeMs: sourceProposal.updatedTs,
      receivedAtMs: sourceProposal.updatedTs,
      maxAgeMs: 30_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
    },
    evaluatedAtMs: VENUE_ARRIVAL_MS,
    revision: `${label}-revision:${stableHash128Hex(canonicalJson({
      proposalAlias: proposalAlias.systemId,
      revisionDigest: proposalAlias.revisionDigest,
      label,
    }))}`,
  });
  const seed = proposalSeed('BASIS', {
    key: sourceProposal.id,
    sourceId: sourceProposal.id,
    symbol: sourceProposal.symbol,
    direction: sourceProposal.direction,
    status: sourceProposal.status,
    createdAtMs: sourceProposal.createdTs,
    updatedAtMs: sourceProposal.updatedTs,
    expiresAtMs: sourceProposal.invalidationSpec.expiresTs,
    configRevision,
    canonical: canonicalProposal,
    metadata: { correlationId: sourceProposal.correlationId, truth: ownerTruth('metadata') },
    configuration: { truth: ownerTruth('configuration') },
    expiration: { truth: ownerTruth('expiration') },
    instruments: { truth: ownerTruth('instruments') },
    economics: {
      requestedCapital: String(sourceProposal.suggestedNotionalUsd),
      exactSourceIds: [sourceProposal.id],
    },
    evaluatedAtMs: VENUE_ARRIVAL_MS,
    source: sourceProposal,
  });
  const opportunityPolicy = eligibilityPolicy({
    authority: {
      sourceId: `capital.eligibility.${sourceProposal.id}`,
      issuedAtMs: VENUE_ARRIVAL_MS - 10_000,
      effectiveFromMs: VENUE_ARRIVAL_MS - 5_000,
      effectiveUntilMs: VENUE_ARRIVAL_MS + 60_000,
    },
    acceptedProposalConfigRevisions: { BASIS: [configRevision] },
    basisMode: 'MANUAL_ARMED',
  });
  const eligibility = evaluateSeeds([seed], {
    policy: opportunityPolicy,
    nowMs: VENUE_ARRIVAL_MS,
  });
  const consideration = eligibility.considerations[0];
  assert.equal(consideration?.status, 'ELIGIBLE', JSON.stringify(consideration));
  const allocationPolicy = budgetPolicy({
    authority: {
      sourceId: `capital.budget.${sourceProposal.id}`,
      issuedAtMs: VENUE_ARRIVAL_MS - 10_000,
      effectiveFromMs: VENUE_ARRIVAL_MS - 5_000,
      effectiveUntilMs: VENUE_ARRIVAL_MS + 60_000,
    },
  });
  const allocation = allocationFor([consideration], {
    candidates: [allocationCandidate(consideration, {
      eligibilityPolicyRevision: opportunityPolicy.authority.revision,
    })],
    policy: allocationPolicy,
    snapshot: budgetSnapshot({ truth: ownerTruth('budget') }),
    nowMs: VENUE_ARRIVAL_MS,
  });
  const allocationDecision = allocation.result.decisions[0];
  const allocationAuthority = allocation.result.authorities[0];
  assert.equal(allocationDecision?.status, 'GRANTED', JSON.stringify(allocationDecision));
  const reservationReduction = reduceReservationBook(EMPTY_RESERVATION_BOOK, {
    kind: 'RESERVE',
    commandId: `reserve:${allocationDecision.id}`,
    nowMs: VENUE_ARRIVAL_MS,
    allocation: allocationDecision,
    authority: allocationAuthority,
    allocationInput: allocation.input,
    capitalClaimKey: `claim:${consideration.id}`,
  });
  assert.equal(reservationReduction.mutation.status, 'APPLIED', JSON.stringify(reservationReduction));
  const reservation = reservationReduction.book.reservations[0]?.reservation;
  assert.ok(reservation, 'Capital owner reservation is absent');

  const configuration = createStagedPlanConfiguration({
    sourceId: `capital.stages.${sourceProposal.id}`,
    issuedAtMs: VENUE_ARRIVAL_MS - 10_000,
    effectiveFromMs: VENUE_ARRIVAL_MS - 5_000,
    effectiveUntilMs: VENUE_ARRIVAL_MS + 25_000,
    maximumPlanExposure: { value: '10', minimum: '0', maximum: '10', unit: 'USDT' },
    maximumPlanDurationMs: { value: 20_000, minimum: 1, maximum: 25_000, unit: 'MILLISECONDS' },
    maximumStageDurationMs: { value: 10_000, minimum: 1, maximum: 20_000, unit: 'MILLISECONDS' },
    maximumEvidenceAgeMs: { value: 1_000, minimum: 1, maximum: 5_000, unit: 'MILLISECONDS' },
    maximumNakedLegAmount: { value: '10', minimum: '0', maximum: '10', unit: 'USDT' },
    maximumNakedLegDurationMs: { value: 1_000, minimum: 1, maximum: 5_000, unit: 'MILLISECONDS' },
  });
  const stages = [
    capitalStage('OBSERVE', 0, ['0', '0', '0'], 'CONFIRM'),
    capitalStage('CONFIRM', 1, ['5', '5', '5'], 'ADD'),
    capitalStage('ADD', 2, ['5', '10', '5'], 'HOLD'),
    capitalStage('HOLD', 3, ['0', '10', '0'], 'REDUCE'),
    capitalStage('REDUCE', 4, ['0', '5', '0'], 'EXIT'),
    capitalStage('EXIT', 5, ['0', '0', '0'], null),
  ];
  const stagedPlanResult = buildStagedPlan({
    reservation,
    proposalIntakeDigest: consideration.proposal.intakeDigest,
    valuationAsset: reservation.valuationAsset,
    configuration,
    stages,
    activeStage: 'OBSERVE',
    createdAtMs: VENUE_ARRIVAL_MS,
    expiresAtMs: VENUE_ARRIVAL_MS + 20_000,
    correlationId: sourceProposal.correlationId,
  });
  assert.equal(stagedPlanResult.ok, true, JSON.stringify(stagedPlanResult));
  const stagedPlan = stagedPlanResult.value;
  const mandateResult = buildCapitalMandate({
    consideration,
    allocationDecisionId: allocationDecision.id,
    reservation,
    plan: stagedPlan,
    configuration,
    targetMaximumExposure: '10',
    createdAtMs: VENUE_ARRIVAL_MS,
    expiresAtMs: VENUE_ARRIVAL_MS + 15_000,
    correlationId: sourceProposal.correlationId,
  });
  assert.equal(mandateResult.ok, true, JSON.stringify(mandateResult));
  const ownerChain = deepFreeze({
    sourceProposal,
    canonicalProposal,
    proposalAlias,
    decisionAlias,
    consideration,
    allocationDecision,
    allocationAuthority,
    reservation,
    stagedPlan,
    mandate: mandateResult.value,
  });
  ownerChainCache.set(suffix, ownerChain);
  return ownerChain;
}

export function makeNormalBasisBinding({
  suffix = 'default',
  maxNakedDurationMs = 1_000,
  attempt = 0,
  spotQuantity = '0.1',
  perpQuantity = '0.1',
  expectedBindingOk = true,
} = {}) {
  const ownerChain = buildNormalBasisOwnerChain(suffix);
  const canonicalProposalId = ownerChain.canonicalProposal.canonicalId;
  const canonicalDecisionId = ownerChain.decisionAlias.canonicalProjectionId;
  const spotProbe = orderFixture({
    fixtureId: `fixture-l09-policy-spot-${suffix}`,
    product: 'SPOT', side: 'BUY', orderType: 'LIMIT', timeInForce: 'GTC',
    price: '100', quantity: spotQuantity,
  });
  const spotOwnerInput = deepFreeze(passingPreflight(spotProbe));
  const spotCapability = bindSpotOrderTifCapability(
    spotOwnerInput.registrySnapshot,
    spotOwnerInput.sizingRequest,
  );
  assert.equal(spotCapability.ok, true, spotCapability.reasonCodes?.join(','));
  const capability = spotCapability.binding;

  const perpProbe = orderFixture({
    fixtureId: `fixture-l09-policy-perp-${suffix}`,
    product: 'USD_M_PERPETUAL', side: 'SELL', orderType: 'LIMIT', timeInForce: 'GTC',
    price: '99', quantity: perpQuantity,
  });
  const perpPreview = runExchangeTwinScenario(scenarioInput({
    fixture: perpProbe,
    events: baselineEvents(perpProbe, { bids: [{ price: '99', quantity: perpQuantity }] }),
    overrides: { scenarioId: `scenario-l09-policy-perp-${suffix}` },
  }));
  const perpResult = perpPreview.preflights[0].result;
  assert.equal(perpResult.staticState, 'PASS', perpResult.reasonCodes.join(','));

  const foundationInput = {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: 'BTCUSDT',
    proposal: {
      canonicalProposalId,
      observedAtMs: ownerChain.canonicalProposal.observedAt.sourceTimeMs,
      maxAgeMs: 30_000,
      expiresAtMs: ownerChain.canonicalProposal.expiresAtMs,
    },
    attempt,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs,
    spotQuantity: Number(spotQuantity),
    perpQuantity: Number(perpQuantity),
    openingOrder: ['SPOT', 'PERP'],
  };
  const ownerPlan = createExecutionPlanDefinition(foundationInput);
  const riskInput = timeAlignedRiskInput(ownerPlan, ownerChain.canonicalProposal);
  const riskVerdict = evaluateMultiLegRisk(riskInput);
  if (expectedBindingOk) {
    assert.equal(riskVerdict.allowed, true, JSON.stringify(riskVerdict.blockingCodes));
  }
  const policyValidUntilMs = capability.validUntilMs;
  const actions = [
    makeAction({
      step: 0, legId: 'leg-spot', quantity: spotQuantity, price: '100', timeInForce: 'GTC',
    }),
    makeAction({
      step: 1, legId: 'leg-perp', quantity: perpQuantity, price: '99', timeInForce: 'GTC',
      dependsOnActualFillLegId: 'leg-spot',
    }),
  ];
  const scenarios = [
    makeScenario({
      scenarioId: 'scenario-full', probabilityPpm: 900_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: spotQuantity },
        { legId: 'leg-perp', filledQuantity: perpQuantity },
      ],
    }),
    makeScenario({
      scenarioId: 'scenario-tail', probabilityPpm: 100_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: '0' },
        { legId: 'leg-perp', filledQuantity: '0' },
      ],
      lossQuote: '8', adverseSelectionQuote: '8',
    }),
  ];
  const authorizationRevision = `capital-authorization:${capitalDigest({
    intentAlias: ownerChain.decisionAlias,
    mandateDigest: ownerChain.mandate.digest,
    reservation: ownerChain.reservation,
    stagedPlanDigest: ownerChain.stagedPlan.digest,
  })}`;
  const mandateRevision = `capital-mandate:${ownerChain.mandate.digest}`;
  const capitalReservationRevision = `capital-reservation:${capitalDigest(ownerChain.reservation)}`;
  const stagedPlanRevision = `capital-staged-plan:${ownerChain.stagedPlan.digest}`;
  const operatorApprovalRevision = `capital-approval:${capitalDigest({
    mandateId: ownerChain.mandate.id,
    mandateDigest: ownerChain.mandate.digest,
    stagedPlanDigest: ownerChain.stagedPlan.digest,
  })}`;
  const riskVerdictRevision = `foundation-risk-verdict:${stableHash128Hex(canonicalJson(riskVerdict))}`;
  const candidate = makeCandidate({
    actions,
    scenarios,
    authorizationRevision,
    mandateRevision,
    capitalReservationRevision,
    stagedPlanRevision,
    operatorApprovalRevision,
    riskVerdictRevision,
    expiresAtMs: policyValidUntilMs,
    distribution: {
      observedAtMs: VENUE_ARRIVAL_MS - 1_000,
      validUntilMs: policyValidUntilMs,
    },
  });
  const input = makeExecutionPolicyInput({
    authority: {
      intentId: canonicalDecisionId,
      intentRevision: ownerChain.decisionAlias.revisionDigest,
      externalPlanId: ownerPlan.planId,
      correlationId: ownerPlan.correlationId,
      authorizationRevision,
      mandateId: ownerChain.mandate.id,
      mandateRevision,
      capitalReservationId: ownerChain.reservation.id,
      capitalReservationRevision,
      stagedPlanId: ownerChain.stagedPlan.id,
      stagedPlanRevision,
      operatorApprovalId: deriveEventId({
        streamId: `capital-approval:${ownerChain.mandate.id}`,
        sequence: ownerChain.mandate.digest,
      }),
      operatorApprovalRevision,
      riskVerdictId: deriveEventId({
        streamId: `foundation-risk:${ownerPlan.planId}`,
        sequence: riskVerdictRevision,
      }),
      riskVerdictRevision,
      observedAtMs: VENUE_ARRIVAL_MS - 1_000,
      validUntilMs: policyValidUntilMs,
      mandateConstraints: {
        ownerRevision: mandateRevision,
        maxNakedDurationMs,
      },
      capitalConstraints: { ownerRevision: capitalReservationRevision, maxNakedDurationMs },
      riskConstraints: { ownerRevision: riskVerdictRevision, maxNakedDurationMs },
      approvalConstraints: { ownerRevision: operatorApprovalRevision, maxNakedDurationMs },
    },
    legs: [spotPolicyLeg(capability), perpPolicyLeg(perpResult)],
    candidates: [candidate],
  });
  input.evaluatedAtMs = VENUE_ARRIVAL_MS;
  input.dependencies = input.dependencies.map((dependency) => ({
    ...dependency,
    revision: dependency.kind === 'INSTRUMENT_FILTER'
      ? deriveSpotOrderTifDependencyRevision([capability]) : dependency.revision,
    observedAtMs: VENUE_ARRIVAL_MS - 1_000,
    validUntilMs: policyValidUntilMs,
  }));
  const ownerBindings = {
    schema: EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
    spotOrderTifOwnerInputs: [spotOwnerInput],
  };
  const entry = evaluateNormalBasisEntryBinding(input, ownerBindings);
  assert.equal(entry.ok, true, JSON.stringify(entry));
  const foundation = bindNormalBasisFoundationPlan(entry.binding, ownerPlan);
  assert.equal(foundation.ok, expectedBindingOk, foundation.reasonCodes?.join(','));
  return {
    binding: foundation.ok ? foundation.binding : null,
    bindingResult: foundation,
    entryBinding: entry.binding,
    capability,
    foundationInput,
    ownerBindings,
    ownerChain,
    ownerPlan,
    policyInput: input,
    riskInput,
    riskVerdict,
  };
}

export function positionModeEvidence(projection) {
  return {
    schema: NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA,
    owner: 'BINANCE_PRIVATE_TRUTH',
    projection,
    sendEligible: false,
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  };
}

function stageTerms(binding, stage) {
  if (stage === 'ENTRY_SPOT') return {
    product: 'SPOT', side: 'BUY', price: binding.entry.spotAction.price,
  };
  if (stage === 'ENTRY_HEDGE') return {
    product: 'USD_M_PERPETUAL', side: 'SELL', price: binding.entry.perpAction.price,
  };
  if (stage === 'EXIT_SPOT' || stage === 'RECOVERY_CLOSE_SPOT') return {
    product: 'SPOT', side: 'SELL', price: '100',
  };
  return { product: 'USD_M_PERPETUAL', side: 'BUY', price: '99' };
}

function requestSequenceFor(ownerRequest) {
  if (ownerRequest.leg.phase === 'OPEN') return ownerRequest.leg.key === 'SPOT' ? 1 : 2;
  return ownerRequest.leg.key === 'SPOT' ? 3 : 4;
}

function l03ClockSamples(product) {
  return [0, 1, 2].map((index) => {
    const monotonicSendMs = 1_000 + (index * 3_000);
    const monotonicReceiveMs = monotonicSendMs + 100;
    const utcSendEpochMs = 1_700_000_000_000 + monotonicSendMs;
    return {
      product,
      environment: 'PRODUCTION',
      utcSendEpochMs,
      utcReceiveEpochMs: 1_700_000_000_000 + monotonicReceiveMs,
      monotonicSendMs,
      monotonicReceiveMs,
      serverEpochMs: utcSendEpochMs + 75,
    };
  });
}

function buildPrivateTruthEvidence(binding, product) {
  const policyLeg = product === 'SPOT' ? binding.entry.spotLeg : binding.entry.perpLeg;
  if (product === 'SPOT') {
    const seed = buildL05SpotOwnerEvidence({
      accountRealmId: policyLeg.accountRealmId,
      targetSymbol: binding.ownerPlan.symbol,
      evaluatedAtMs: PRIVATE_EVIDENCE_AT_MS,
      resultRevision: `foundation-reconciliation-result:${'0'.repeat(24)}`,
    });
    const owned = buildL05SpotOwnerEvidence({
      accountRealmId: policyLeg.accountRealmId,
      targetSymbol: binding.ownerPlan.symbol,
      evaluatedAtMs: PRIVATE_EVIDENCE_AT_MS,
      resultRevision: `foundation-reconciliation-result:${seed.projection
        .reconciliationObservation.sourceCutRevision.slice(-24)}`,
    });
    return {
      evidence: positionModeEvidence(owned.projection),
      lifecycleRevisions: [owned.witness.lifecycleRevision],
    };
  }
  const projection = buildNormalBasisL05Projection({
    accountRealmId: policyLeg.accountRealmId,
    targetSymbol: binding.ownerPlan.symbol,
    evaluatedAtMs: PRIVATE_EVIDENCE_AT_MS,
  });
  return {
    evidence: positionModeEvidence(projection),
    lifecycleRevisions: [`l05lifecycle_${createHash('sha256')
      .update(canonicalJson({
        product,
        accountRealmId: policyLeg.accountRealmId,
        sourceCutRevision: projection.reconciliationObservation.sourceCutRevision,
      })).digest('hex')}`],
  };
}

function attachAliasedL06(fixture, binding, ownerRequest, privateTruth) {
  const policyLeg = ownerRequest.leg.key === 'SPOT'
    ? binding.entry.spotLeg : binding.entry.perpLeg;
  const requestSequence = requestSequenceFor(ownerRequest);
  const parameters = [
    ['symbol', binding.ownerPlan.symbol],
    ['side', fixture.side],
    ['type', 'LIMIT'],
    ['timeInForce', 'GTC'],
    ['quantity', fixture.quantity],
    ['price', fixture.price],
  ];
  if (fixture.product === 'USD_M_PERPETUAL') {
    parameters.push(['positionSide', 'BOTH']);
    parameters.push(['reduceOnly', String(ownerRequest.leg.reduceOnly)]);
  }
  const l03 = constructUnsignedRequest({
    contractId: fixture.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
    expectedProduct: fixture.product,
    expectedEnvironment: 'PRODUCTION',
    parameters,
    clockSamples: l03ClockSamples(fixture.product),
    nowMonotonicMs: 7_100,
    correlationId: binding.ownerPlan.correlationId,
    requestSequence,
    clientOrderIdentity: {
      planId: binding.ownerPlan.planId,
      legId: ownerRequest.leg.legId,
      attempt: 0,
    },
  });
  assert.equal(l03.ok, true, JSON.stringify(l03));
  assert.equal(l03.request.clientOrderId, ownerRequest.leg.clientOrderId);
  const projection = privateTruth.evidence.projection;
  const reconciliation = projection.reconciliationObservation;
  assert.equal(reconciliation?.owner, 'FOUNDATION_RECONCILIATION');
  assert.equal(reconciliation?.status, 'EXACT');
  const resultNotional = multiplyTwinDecimals(fixture.price ?? '100', fixture.quantity);
  const input = mutationInputFixture({
    identity: {
      globalCorrelationId: binding.ownerPlan.correlationId,
      decisionId: binding.entry.plan.intentId,
      strategyId: 'BASIS',
      proposalId: binding.ownerPlan.proposal.canonicalProposalId,
      capitalMandateId: binding.entry.plan.mandateId,
      capitalReservationId: binding.entry.plan.capitalReservationId,
      ticketId: binding.ownerPlan.planId,
      legId: ownerRequest.leg.legId,
      clientOrderId: ownerRequest.leg.clientOrderId,
      attempt: 0,
      product: fixture.product,
      accountRealmId: policyLeg.accountRealmId,
      symbol: binding.ownerPlan.symbol,
      mutationKind: 'PLACE_ORDER',
      contractId: fixture.product === 'SPOT' ? 'SPOT_ORDER_POST' : 'USDM_ORDER_POST',
      contractState: 'CURRENT',
      requestId: l03.request.requestIdentity.requestId,
      requestSequence: l03.request.requestIdentity.requestSequence,
      intentFingerprint: l03.request.requestIdentity.intentFingerprint,
      signerProfile: l03.request.signerProfile,
    },
    requestedQuantity: fixture.quantity,
    preflightResult: {
      instrumentRevision: fixture.instrumentRevision,
      sourceEvidenceRevision: fixture.sourceEvidenceRevision,
      requestedPrice: fixture.price,
      validationPrice: fixture.price ?? '100',
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
      sanitizedRequestContentHash: `sha256:${createHash('sha256')
        .update(l03.request.material.query).digest('hex')}`,
      privateProjectionRevision: projection.projectionRevision,
      privateSourceCutRevision: reconciliation.sourceCutRevision,
      lifecycleRevisions: privateTruth.lifecycleRevisions,
      foundationReconciliationResultRevision: reconciliation.resultRevision,
      capitalMandateRevision: binding.entry.plan.mandateRevision,
      riskVerdictRevision: binding.entry.plan.riskVerdictRevision,
      privateEvaluatedAtMs: projection.evaluatedAtMs,
      validUntilMs: Math.min(L06_T0 + 10_000, projection.validUntilMs),
    },
  });
  const persisted = submittingPersisted(input);
  return {
    ...fixture,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
  };
}

function bridgeSpotEvents(events, fixture, binding, stage) {
  const ownerInput = stage === 'ENTRY_SPOT'
    ? binding.entry.ownerBindings.spotOrderTifOwnerInputs[0]
    : deepFreeze(passingPreflight(fixture));
  const result = bindSpotOrderTifCapability(
    ownerInput.registrySnapshot,
    ownerInput.sizingRequest,
  );
  assert.equal(result.ok, true, result.reasonCodes?.join(','));
  return events.map((candidate) => candidate.kind !== 'PREFLIGHT_EVIDENCE'
    ? candidate
    : event(
      'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE',
      candidate.sequence,
      candidate.occurredAtMs,
      {
        fixtureId: fixture.fixtureId,
        ...ownerInput,
        expectedCapabilityRevision: result.binding.capabilityRevision,
      },
      { sourceSequence: candidate.sourceSequence },
    ));
}

function bookFor(side, price, quantity, fillQuantity) {
  const available = fillQuantity ?? quantity;
  return side === 'BUY'
    ? { bids: [{ price: '98', quantity: '1' }], asks: [{ price, quantity: available }] }
    : { bids: [{ price, quantity: available }], asks: [{ price: '102', quantity: '1' }] };
}

export function makeTwinLegObservation({
  binding,
  ownerRequest,
  stage,
  ownerCheckpoint,
  ownerCheckpointHydrator,
  privateTruthEvidence = null,
  localMode = 'OBSERVED',
  fillQuantity,
  fixtureId,
} = {}) {
  fixtureCounter += 1;
  const terms = stageTerms(binding, stage);
  const quantity = String(ownerRequest.leg.quantity);
  const id = fixtureId ?? `fixture-l09-${stage.toLowerCase()}-${fixtureCounter}`;
  let fixture = orderFixture({
    fixtureId: id,
    product: terms.product,
    side: terms.side,
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    price: terms.price,
    quantity,
  });
  const ownerPrivateTruth = buildPrivateTruthEvidence(binding, terms.product);
  const selectedPrivateTruth = privateTruthEvidence === null
    ? ownerPrivateTruth
    : { ...ownerPrivateTruth, evidence: privateTruthEvidence };
  fixture = attachAliasedL06(fixture, binding, ownerRequest, selectedPrivateTruth);
  const book = bookFor(terms.side, terms.price, quantity, fillQuantity);
  let events = baselineEvents(fixture, {
    ...book,
    includePrivate: false,
    httpOutcome: localMode === 'AMBIGUOUS' ? 'TIMEOUT' : 'ACK',
  });
  if (terms.product === 'SPOT') events = bridgeSpotEvents(events, fixture, binding, stage);
  if (localMode === 'REJECTED') {
    events = events.map((candidate) => candidate.kind !== 'SYMBOL_STATUS'
      ? candidate
      : event('SYMBOL_STATUS', candidate.sequence, candidate.occurredAtMs, {
        ...candidate.payload,
        status: 'HALT',
        evidenceRevision: `normal-basis-halt:${'1'.repeat(24)}`,
      }, { sourceSequence: candidate.sourceSequence }));
  } else if (localMode === 'OBSERVED') {
    const venueEvents = events.filter((candidate) => (
      candidate.kind !== 'HTTP_DELIVERY' && candidate.kind !== 'PRIVATE_DELIVERY'
    ));
    const venueState = runExchangeTwinScenario(scenarioInput({
      fixture,
      events: venueEvents,
      overrides: { scenarioId: `scenario-${id}-venue` },
    }));
    const venueOrder = orderByFixtureId(venueState, id);
    events = [
      ...venueEvents,
      event('PRIVATE_DELIVERY', 7, TWIN_T0 + 20 + fixture.latency.venueToPrivateMs, {
        fixtureId: id,
        venueRevision: venueOrder.venueRevision,
      }),
      event('HTTP_DELIVERY', 8, TWIN_T0 + 20 + fixture.latency.venueToHttpMs, {
        fixtureId: id,
        outcome: 'ACK',
      }),
    ];
  }
  const scenario = scenarioInput({
    fixture,
    events,
    overrides: { scenarioId: `scenario-${id}` },
  });
  const observation = runNormalBasisTwinLeg({
    binding,
    stage,
    ownerRequest,
    scenario,
    ownerCheckpoint,
    ownerCheckpointHydrator,
    privateTruthEvidence: selectedPrivateTruth.evidence,
  });
  return { fixture, observation, scenario };
}

export function failure(code) {
  return {
    code,
    message: code,
    retryable: false,
    recommendedOperatorAction: 'Inspect retained synthetic evidence.',
  };
}
