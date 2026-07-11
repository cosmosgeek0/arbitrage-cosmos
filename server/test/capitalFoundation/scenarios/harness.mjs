import { isDeepStrictEqual } from 'node:util';

import {
  capitalDigest,
  deriveCapitalMandateId,
  transitionCapitalStage,
} from '../../../dist/capitalFoundation/contracts/index.js';
import { deriveAccountCapitalProjection } from '../../../dist/capitalFoundation/accountTruth/index.js';
import { projectPortfolioBudgetSnapshotFromAccount } from '../../../dist/capitalFoundation/budgets/index.js';
import {
  EMPTY_RESERVATION_BOOK,
  reduceReservationBook,
} from '../../../dist/capitalFoundation/allocation/index.js';
import {
  createOperatorApprovalState,
  deriveApprovalPolicyDigest,
  evaluateOperatorApproval,
  reduceOperatorApprovalState,
} from '../../../dist/capitalFoundation/approvals/index.js';
import { planEconomicAction } from '../../../dist/capitalFoundation/actions/index.js';
import {
  createCapitalCheckpointEvent,
  projectRestartSafety,
  replayCapitalCheckpointEvents,
  serializeCapitalCheckpoint,
} from '../../../dist/capitalFoundation/checkpoint/index.js';
import {
  NOW,
  actionDecision,
  actionProjection,
  allocationCandidate,
  allocationFor,
  baseWorld,
  budgetSnapshot,
  controlPosture,
  economicComponent,
  economicReport,
  eligibilityPolicy,
  evaluateSeeds,
  positionLeg,
  projectedPosition,
  proposalSeed,
  superviseBasis,
  superviseVolume,
  terminalTuple,
  truth,
} from './fixtures.mjs';

const FORBIDDEN_TERMINAL_KEYS = new Set([
  'order', 'orders', 'orderid', 'clientorderid', 'ordertype', 'timeinforce',
  'limitprice', 'stopprice', 'signedrequest', 'borrowrequest', 'repayrequest',
]);

function fail(id, invariant, detail) {
  throw new Error(`${id} invariant=${invariant}${detail ? ` :: ${detail}` : ''}`);
}

function check(id, invariant, condition, detail = '') {
  if (!condition) fail(id, invariant, detail);
}

function same(id, invariant, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(id, invariant, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function scanKeys(value, path = '$', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...scanKeys(entry, `${path}[${index}]`, seen)));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_TERMINAL_KEYS.has(key.toLowerCase())) findings.push(`${path}.${key}`);
      findings.push(...scanKeys(entry, `${path}.${key}`, seen));
    }
  }
  return findings;
}

function assertTerminal(id, terminal) {
  same(id, 'TERMINAL_TUPLE_KEYS', Object.keys(terminal).sort(), [
    'capitalDecision', 'economicAttribution', 'positionActionIntent', 'topologyProjection',
  ]);
  check(id, 'CAPITAL_DECISION_PRESENT', terminal.capitalDecision.length > 0);
  check(id, 'POSITION_ACTION_INTENT_PRESENT', terminal.positionActionIntent.length > 0);
  check(id, 'ECONOMIC_ATTRIBUTION_PRESENT', terminal.economicAttribution.length > 0);
  check(id, 'TOPOLOGY_PROJECTION_PRESENT', terminal.topologyProjection.nodes.length > 0);
  for (const intent of terminal.positionActionIntent) {
    const intentNode = terminal.topologyProjection.nodes.find(
      (node) => node.kind === 'ACTION_INTENT' && node.sourceId === intent.id,
    );
    check(id, 'INTENT_LINKED_TO_TOPOLOGY', intentNode !== undefined, intent.id);
    check(id, 'INTENT_POSITION_EXPOSED', terminal.topologyProjection.exposedPositionIds.includes(intent.positionId), intent.positionId);
    const criticalPath = terminal.topologyProjection.criticalPaths.find((path) => path.positionId === intent.positionId);
    check(id, 'INTENT_LINKED_TO_CRITICAL_PATH', criticalPath?.nodeIds.includes(intentNode.id) === true, intent.id);
  }
  for (const decision of terminal.capitalDecision) {
    check(id, 'CAPITAL_DECISION_LINKED_TO_TOPOLOGY', terminal.topologyProjection.nodes.some(
      (node) => node.kind === 'CAPITAL_BUDGET' && node.sourceId === decision.id,
    ), decision.id);
  }
  check(id, 'ECONOMICS_LINKED_TO_TOPOLOGY', terminal.topologyProjection.nodes.filter(
    (node) => node.kind === 'ECONOMICS' && !node.sourceId.endsWith(':economics'),
  ).length >= terminal.economicAttribution.length);
  check(id, 'EXPOSED_POSITION_VISIBLE', terminal.topologyProjection.exposedPositionIds.length > 0);
  same(id, 'NO_ORDER_LIKE_TERMINAL_OUTPUT', scanKeys(terminal), []);
  return terminal;
}

function finish(id, world, overrides = {}) {
  const positions = overrides.positions ?? [world.position];
  const intents = overrides.intents ?? [world.intent];
  const reports = overrides.reports ?? [world.report];
  return assertTerminal(id, terminalTuple({
    considerations: overrides.considerations ?? world.eligibility.considerations,
    decisions: overrides.decisions ?? world.allocation.result.decisions,
    positions,
    intents,
    reports,
    topologyExtras: overrides.topologyExtras ?? {},
  }));
}

function sizedCandidate(consideration, amount, overrides = {}) {
  const base = allocationCandidate(consideration);
  const scale = (items) => items.map((item) => ({ ...item, amount }));
  return allocationCandidate(consideration, {
    requestedAmount: amount,
    grossExposureIncrease: amount,
    collateralRequired: amount,
    marginRequired: amount,
    strategyRequirements: scale(base.strategyRequirements),
    symbolRequirements: scale(base.symbolRequirements),
    correlatedGroupRequirements: scale(base.correlatedGroupRequirements),
    venueInstrumentRequirements: scale(base.venueInstrumentRequirements),
    borrowRequirements: scale(base.borrowRequirements),
    liquidityRequirements: scale(base.liquidityRequirements),
    ...overrides,
  });
}

function reserveWorld(world, overrides = {}) {
  const allocation = overrides.allocation ?? world.allocation.result.decisions[0];
  const authority = world.allocation.result.authorities.find(
    (candidate) => candidate.allocationDecisionId === allocation.id,
  );
  return reduceReservationBook(overrides.book ?? EMPTY_RESERVATION_BOOK, {
    kind: 'RESERVE',
    commandId: overrides.commandId ?? `reserve:${allocation.id}`,
    nowMs: overrides.nowMs ?? NOW,
    allocation,
    authority,
    allocationInput: world.allocation.input,
    capitalClaimKey: overrides.capitalClaimKey ?? `claim:${allocation.considerationId}`,
  });
}

function approvalPolicy(overrides = {}) {
  const authorityOverrides = overrides.authority ?? {};
  const semantics = {
    authority: {
      sourceId: 'capital.scenario.approval-policy',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 5_000,
      effectiveUntilMs: NOW + 1_000_000,
      ...authorityOverrides,
    },
    configRevision: 'cfg-scenario-1',
    strategy: 'BASIS',
    symbols: ['BTCUSDT'],
    instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    allowedActionClasses: ['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'RECOVERY'],
    maximumNotional: '100',
    valuationAsset: 'USDT',
    stageLimits: [{ stage: 'PROBE', maximumExposure: '25' }, { stage: 'ADD', maximumExposure: '50' }],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'authority')),
  };
  return {
    ...semantics,
    authority: {
      ...semantics.authority,
      revision: deriveApprovalPolicyDigest(semantics),
    },
  };
}

function approval(overrides = {}) {
  return {
    id: overrides.id ?? 'cappr_scenario', operatorIdentityReference: 'operator:scenario',
    proposalId: 'proposal-scenario', proposalRevision: 'proposal-r1',
    proposalIntakeDigest: 'proposal-intake-1', mandateId: 'mandate-scenario',
    mandateRevision: 1, mandateDigest: 'mandate-digest-1', stagedPlanId: 'plan-scenario',
    stagedPlanRevision: 1, stagedPlanDigest: 'plan-digest-1', strategy: 'BASIS',
    symbols: ['BTCUSDT'], instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    allowedActionClasses: ['OPEN', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'RECOVERY'],
    maximumNotional: '100', valuationAsset: 'USDT', mode: 'MANUAL_ARMED',
    configRevision: 'cfg-scenario-1', issuedAtMs: NOW - 1_000, expiresAtMs: NOW + 1_000,
    revokedAtMs: null, revocationReasonReference: null,
    stageLimits: [{ stage: 'PROBE', maximumExposure: '25' }, { stage: 'ADD', maximumExposure: '50' }],
    reasonReference: 'scenario-approval', useScopeKey: 'scope:scenario',
    ...overrides,
  };
}

function approvalContext(overrides = {}) {
  return {
    nowMs: NOW, proposalId: 'proposal-scenario', proposalRevision: 'proposal-r1',
    proposalIntakeDigest: 'proposal-intake-1', mandateId: 'mandate-scenario', mandateRevision: 1,
    mandateDigest: 'mandate-digest-1', stagedPlanId: 'plan-scenario', stagedPlanRevision: 1,
    stagedPlanDigest: 'plan-digest-1', configRevision: 'cfg-scenario-1', actionClass: 'OPEN',
    requestedNotional: '25', stage: 'PROBE', useScopeKey: 'scope:scenario', strategy: 'BASIS',
    symbols: ['BTCUSDT'], instruments: ['BINANCE:SPOT:BTCUSDT', 'BINANCE:PERP:BTCUSDT'],
    controlPosture: controlPosture(), correlationId: 'cor:scenario-approval',
    ...overrides,
  };
}

function signal(state, strength, sourceId) {
  return { state, strength, truth: truth(sourceId), evidenceIds: [sourceId] };
}

function accountSource(sourceId, overrides = {}) {
  return {
    sourceTimeMs: NOW - 10,
    receivedAtMs: NOW - 5,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function accountSnapshot(key, value, sourceOverrides = {}) {
  return {
    value,
    provenance: {
      accountId: 'scenario-account',
      capitalPoolId: `scenario-${key}-pool`,
      coherentCutId: 'scenario-account-cut',
    },
    source: accountSource(`scenario.account.${key}`, sourceOverrides),
    revision: `${key}-r1`,
    evidenceReferences: [`scenario-${key}-evidence`],
  };
}

function realAccountProjection({ incomplete = false } = {}) {
  return deriveAccountCapitalProjection({
    evaluatedAtMs: NOW,
    valuationAsset: 'USDT',
    spot: accountSnapshot('spot', incomplete ? null : {
      balances: [{ asset: 'USDT', total: '1000', available: '900', locked: '100' }],
      positions: [],
    }),
    futures: accountSnapshot('futures', {
      wallets: [{
        asset: 'USDT', walletBalance: '100', availableBalance: '100', marginBalance: '100',
        initialMargin: '0', maintenanceMargin: '0',
      }],
      positions: [],
    }),
    liabilities: accountSnapshot('liabilities', []),
    orders: accountSnapshot('orders', []),
    plans: accountSnapshot('plans', []),
    reservations: accountSnapshot('reservations', []),
    valuations: accountSnapshot('valuations', []),
    hardReserves: accountSnapshot('hardReserves', [{
      reserveId: 'scenario-recovery-reserve', asset: 'USDT', amount: '100', reasonCode: 'RISK_REDUCTION',
    }]),
    borrowTruthReferences: [],
  });
}

function accountBoundPortfolioSnapshot(accountProjection) {
  return projectPortfolioBudgetSnapshotFromAccount({
    accountProjection,
    portfolio: {
      marginHeadroomAvailable: '1000',
      grossExposureAndCommitments: '0',
      netDirectionalExposure: '0',
      strategyUse: [], symbolUse: [], correlatedGroupUse: [], venueInstrumentUse: [],
      liquidityCapacityByKey: [{ key: 'GLOBAL_LIQUIDITY', amount: '10000' }],
      commitmentCoverage: {
        orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
        partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
      },
      commitments: [],
    },
  });
}

function causalFreeze(id, world, code) {
  const result = planEconomicAction({
    position: actionProjection(world.position),
    decision: actionDecision('FREEZE_NEW_ACTIONS', {
      why: [`causal blocker ${code}`],
      triggerCodes: [code],
      blockingFacts: [code],
      supportingEvidenceIds: [],
    }),
    controlPosture: controlPosture(),
    nowMs: NOW,
    idempotencyKey: `scenario:${id}:${code}`,
    correlationKey: `scenario:${id}`,
  });
  check(id, 'CAUSAL_FREEZE_INTENT_VALID', result.ok, result.ok ? '' : result.failure.code);
  return result.value;
}

function causalReport(world, code) {
  return economicReport([
    economicComponent(`causal-${code}`, 'OPERATIONAL_RECOVERY_COST', null, {
      status: 'MISSING', sourceIds: [], reasonCodes: [code],
    }),
  ], {
    positionId: world.position.id,
    opportunityId: world.eligibility.considerations[0].id,
    correlationId: `scenario:${code}`,
  });
}

function assertCausalTerminal(id, terminal, code) {
  check(id, 'CAUSAL_ACTION_PROPAGATED', terminal.positionActionIntent.some(
    (intent) => intent.blockingFacts.includes(code),
  ), code);
  check(id, 'CAUSAL_ECONOMICS_PROPAGATED', terminal.economicAttribution.some(
    (attribution) => attribution.components.some((component) => component.reasonCodes.includes(code)),
  ), code);
  check(id, 'CAUSAL_TOPOLOGY_PROPAGATED', terminal.topologyProjection.nodes.some(
    (node) => node.kind === 'ACTION_INTENT' && node.blockingReasons.includes(code),
  ), code);
  return terminal;
}

function oneLegExpected(position) {
  return [
    { instrumentId: position.legs[0].instrumentId, side: 'LONG' },
    { instrumentId: `${position.thesis.proposalId}:missing-perp`, side: 'SHORT' },
  ];
}

function scenario(id, name, run) {
  return Object.freeze({ id, name, run });
}

export const CAPITAL_SUPERVISION_SCENARIOS = Object.freeze([
  scenario('CS-01', 'scarce capital chooses deterministic grants', () => {
    const id = 'CS-01';
    const seeds = [
      proposalSeed('BASIS', { key: 'scarce-a', symbol: 'BTCUSDT', economics: { requestedCapital: '80' } }),
      proposalSeed('BASIS', { key: 'scarce-b', symbol: 'ETHUSDT', economics: { requestedCapital: '80' } }),
    ];
    const eligibility = evaluateSeeds(seeds);
    const candidates = eligibility.considerations.map((item) => sizedCandidate(item, '80'));
    const allocation = allocationFor(eligibility.considerations, { candidates, snapshot: budgetSnapshot({ entryCollateralAvailable: '100', marginHeadroomAvailable: '100' }) });
    same(id, 'SCARCE_CAPITAL_SPLIT', allocation.result.decisions.map((item) => item.grantedAmount), ['80', '20']);
    check(id, 'SCARCE_CAPITAL_EXHAUSTED', allocation.result.remainder.entryCollateralAvailable === '0');
    const world = baseWorld({ key: 'scarce-terminal' });
    return finish(id, world, { considerations: eligibility.considerations, decisions: allocation.result.decisions });
  }),

  scenario('CS-02', 'tie breaking survives replay and input reversal', () => {
    const id = 'CS-02';
    const eligibility = evaluateSeeds([
      proposalSeed('BASIS', { key: 'tie-a', symbol: 'BTCUSDT', economics: { requestedCapital: '70' } }),
      proposalSeed('BASIS', { key: 'tie-b', symbol: 'ETHUSDT', economics: { requestedCapital: '70' } }),
    ]);
    const candidates = eligibility.considerations.map((item) => sizedCandidate(item, '70'));
    const snapshot = budgetSnapshot({ entryCollateralAvailable: '100', marginHeadroomAvailable: '100' });
    const first = allocationFor(eligibility.considerations, { candidates, snapshot });
    const second = allocationFor(eligibility.considerations, { candidates: [...candidates].reverse(), snapshot });
    same(id, 'INPUT_ORDER_INDEPENDENCE', first.result, second.result);
    same(id, 'STABLE_TIE_SPLIT', first.result.decisions.map((item) => item.grantedAmount), ['70', '30']);
    return finish(id, baseWorld({ key: 'tie-terminal' }), { considerations: eligibility.considerations, decisions: first.result.decisions });
  }),

  scenario('CS-03', 'opposing same symbol opportunities conflict', () => {
    const id = 'CS-03';
    const eligibility = evaluateSeeds([
      proposalSeed('BASIS', { key: 'opp-long', symbol: 'BTCUSDT', direction: 'long_spot_short_perp', economics: { requestedCapital: '50' } }),
      proposalSeed('BASIS', { key: 'opp-short', symbol: 'BTCUSDT', direction: 'short_spot_long_perp', economics: { requestedCapital: '50' } }),
    ]);
    const candidates = eligibility.considerations.map((item) => sizedCandidate(item, '50'));
    const allocation = allocationFor(eligibility.considerations, { candidates });
    check(id, 'ELIGIBILITY_DETECTS_BOTH_OPPOSING', eligibility.considerations.every(
      (item) => item.status === 'BLOCKED' && item.reasons.includes('CONFLICTING_OPPORTUNITY'),
    ));
    check(id, 'CONFLICT_NEVER_FUNDED', allocation.result.decisions.every(
      (item) => item.status === 'BLOCKED' && item.grantedAmount === '0',
    ));
    const world = baseWorld({ key: 'conflict-terminal' });
    const code = 'CONFLICTING_OPPORTUNITY';
    return assertCausalTerminal(id, finish(id, world, {
      considerations: eligibility.considerations,
      decisions: allocation.result.decisions,
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
    }), code);
  }),

  scenario('CS-04', 'incomplete account truth blocks allocation', () => {
    const id = 'CS-04';
    const world = baseWorld({ key: 'unknown-account' });
    const incompleteAccount = realAccountProjection({ incomplete: true });
    const blockedBridge = accountBoundPortfolioSnapshot(incompleteAccount);
    check(id, 'ACCOUNT_BRIDGE_FAILS_CLOSED', blockedBridge.ok === false && blockedBridge.snapshot === null);
    check(id, 'ACCOUNT_BRIDGE_TRUTH_REASON', blockedBridge.reasonCodes.includes('ACCOUNT_TRUTH_NOT_COMPLETE'));
    check(id, 'ACCOUNT_BRIDGE_UNKNOWN_AMOUNT_REASON', blockedBridge.reasonCodes.includes('ACCOUNT_ALLOCATABLE_FACT_UNKNOWN'));

    // The bridge intentionally emits no fabricated snapshot for incomplete truth. Re-project a
    // complete account cut, then age that exact account-bound snapshot past its source validity so
    // the allocator can return its own honest, fail-closed decision for the terminal tuple.
    const completeBridge = accountBoundPortfolioSnapshot(realAccountProjection());
    check(id, 'COMPLETE_ACCOUNT_BRIDGE_AVAILABLE', completeBridge.ok === true && completeBridge.snapshot !== null);
    const allocation = allocationFor(world.eligibility.considerations, {
      snapshot: completeBridge.snapshot,
      nowMs: NOW + 1_001,
    });
    check(id, 'ACCOUNT_TRUTH_BLOCKS', allocation.result.decisions[0].status === 'BLOCKED');
    check(id, 'ACCOUNT_TRUTH_REASON', allocation.result.decisions[0].blockingReasons.some((reason) => reason.startsWith('SNAPSHOT_TRUTH_')));
    const code = allocation.result.decisions[0].blockingReasons.find((reason) => reason.startsWith('SNAPSHOT_TRUTH_'));
    check(id, 'ACCOUNT_CAUSAL_CODE_PRESENT', typeof code === 'string');
    return assertCausalTerminal(id, finish(id, world, {
      decisions: allocation.result.decisions,
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
    }), code);
  }),

  scenario('CS-05', 'same capital cannot be double reserved', () => {
    const id = 'CS-05';
    const world = baseWorld({ key: 'double-reserve' });
    const first = reserveWorld(world);
    const second = reserveWorld(world, { book: first.book, commandId: 'reserve:second', capitalClaimKey: 'claim:other' });
    check(id, 'FIRST_RESERVATION_APPLIED', first.mutation.status === 'APPLIED');
    check(id, 'SECOND_RESERVATION_REJECTED', second.mutation.status === 'REJECTED');
    check(id, 'ALLOCATION_RESERVED_ONCE', second.mutation.reasonCodes.includes('ALLOCATION_ALREADY_RESERVED'));
    return finish(id, world, { topologyExtras: { reservations: second.book.reservations.map((item) => item.reservation) } });
  }),

  scenario('CS-06', 'reservation release and expiry are exact and idempotent', () => {
    const id = 'CS-06';
    const releaseWorld = baseWorld({ key: 'release-once' });
    const created = reserveWorld(releaseWorld);
    const reservationId = created.mutation.reservationId;
    const command = { kind: 'RELEASE', commandId: 'release:once', reservationId, nowMs: NOW + 1, reasonCode: 'SCENARIO_CANCELLED' };
    const released = reduceReservationBook(created.book, command);
    const replay = reduceReservationBook(released.book, command);
    const expiryWorld = baseWorld({ key: 'expire-once' });
    const expiring = reserveWorld(expiryWorld, { commandId: 'reserve:expiry' });
    const expiryId = expiring.mutation.reservationId;
    const expiryAt = expiring.book.reservations[0].reservation.expiresAtMs;
    const expired = reduceReservationBook(expiring.book, { kind: 'CONSUME', commandId: 'consume:late', reservationId: expiryId, nowMs: expiryAt, amount: '1' });
    check(id, 'RELEASE_EXACT', released.mutation.releasedAmount === created.book.reservations[0].reservation.amount);
    check(id, 'RELEASE_REPLAY_IDEMPOTENT', replay.mutation.status === 'IDEMPOTENT_REPLAY');
    check(id, 'EXPIRY_EXACT', expired.book.reservations[0].reservation.state === 'EXPIRED' && expired.mutation.reasonCodes.includes('RESERVATION_EXPIRED_BEFORE_COMMAND'));
    return finish(id, releaseWorld, { topologyExtras: { reservations: released.book.reservations.map((item) => item.reservation) } });
  }),

  scenario('CS-07', 'normal and reverse Basis retain leg and borrow geometry', () => {
    const id = 'CS-07';
    const normal = evaluateSeeds([proposalSeed('BASIS', { key: 'basis-normal', direction: 'long_spot_short_perp' })]).considerations[0];
    const reverse = evaluateSeeds([proposalSeed('BASIS', { key: 'basis-reverse', direction: 'short_spot_long_perp' })]).considerations[0];
    same(id, 'NORMAL_BASIS_SIDES', normal.legs.map((leg) => [leg.role, leg.side, leg.borrowRequired]), [['SPOT', 'LONG', false], ['PERPETUAL', 'SHORT', false]]);
    same(id, 'REVERSE_BASIS_SIDES', reverse.legs.map((leg) => [leg.role, leg.side, leg.borrowRequired]), [['SPOT', 'SHORT', true], ['PERPETUAL', 'LONG', false]]);
    const considerations = [normal, reverse];
    const allocation = allocationFor(considerations);
    return finish(id, baseWorld({ key: 'basis-geometry-terminal' }), { considerations, decisions: allocation.result.decisions });
  }),

  scenario('CS-08', 'Volume stays advisory without capital authority', () => {
    const id = 'CS-08';
    const seed = proposalSeed('VOLUME', { key: 'volume-advisory' });
    const eligibility = evaluateSeeds([seed], { policy: eligibilityPolicy({ volumeMode: 'ADVISORY' }) });
    check(id, 'VOLUME_MODE_ADVISORY', eligibility.considerations[0].mode === 'ADVISORY');
    const allocation = allocationFor(eligibility.considerations);
    check(id, 'ADVISORY_CANNOT_RESERVE', allocation.result.decisions[0].status === 'BLOCKED');
    check(id, 'ADVISORY_REASON', allocation.result.decisions[0].blockingReasons.includes('MODE_ADVISORY_CANNOT_RESERVE'));
    const world = baseWorld({ key: 'volume-advisory-terminal' });
    const code = 'MODE_ADVISORY_CANNOT_RESERVE';
    return assertCausalTerminal(id, finish(id, world, {
      considerations: eligibility.considerations,
      decisions: allocation.result.decisions,
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
    }), code);
  }),

  scenario('CS-09', 'proposal expiry between eligibility and approval fails closed', () => {
    const id = 'CS-09';
    const seed = proposalSeed('BASIS', { key: 'expires-between', expiresAtMs: NOW + 1 });
    const before = evaluateSeeds([seed], { nowMs: NOW });
    const after = evaluateSeeds([seed], { nowMs: NOW + 1 });
    check(id, 'ELIGIBLE_BEFORE_EXPIRY', before.considerations[0].status === 'ELIGIBLE');
    check(id, 'BLOCKED_AT_EXPIRY', after.considerations[0].status === 'BLOCKED');
    check(id, 'EXPIRY_REASON', after.considerations[0].reasons.includes('PROPOSAL_EXPIRED'));
    const allocation = allocationFor(after.considerations, { nowMs: NOW + 1 });
    const world = baseWorld({ key: 'expiry-terminal' });
    const code = 'PROPOSAL_EXPIRED';
    return assertCausalTerminal(id, finish(id, world, {
      considerations: after.considerations,
      decisions: allocation.result.decisions,
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
    }), code);
  }),

  scenario('CS-10', 'expired or revoked approval never reaches risk evaluation', () => {
    const id = 'CS-10';
    const policy = approvalPolicy();
    const expiring = createOperatorApprovalState(approval(), policy);
    const expired = evaluateOperatorApproval(expiring, approvalContext({ nowMs: NOW + 1_000 }), policy);
    const revokedState = createOperatorApprovalState(approval({ id: 'cappr_revoked' }), policy);
    const revoked = reduceOperatorApprovalState(revokedState, {
      kind: 'REVOKED', expectedRevision: 1, revokedAtMs: NOW,
      reasonReference: 'scenario-revoked', correlationId: 'cor:scenario-revoked',
    });
    const revokedUse = evaluateOperatorApproval(revoked.value, approvalContext({ nowMs: NOW + 1 }), policy);
    check(id, 'EXPIRED_APPROVAL_REJECTED', !expired.ok && expired.failure.code === 'APPROVAL_EXPIRED');
    check(id, 'REVOKED_APPROVAL_REJECTED', !revokedUse.ok && revokedUse.failure.code === 'APPROVAL_REVOKED');
    const world = baseWorld({ key: 'approval-expired-terminal' });
    const code = 'APPROVAL_REVOKED';
    return assertCausalTerminal(id, finish(id, world, {
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
      topologyExtras: { approvals: [revoked.value.approval] },
    }), code);
  }),

  scenario('CS-11', 'proposal config and stage drift invalidate approval', () => {
    const id = 'CS-11';
    const policy = approvalPolicy();
    const state = createOperatorApprovalState(approval(), policy);
    const cases = [
      [approvalContext({ proposalRevision: 'proposal-r2' }), 'APPROVAL_PROPOSAL_MISMATCH'],
      [approvalContext({ configRevision: 'cfg-scenario-2' }), 'APPROVAL_CONFIG_MISMATCH'],
      [approvalContext({ stagedPlanDigest: 'plan-digest-2' }), 'APPROVAL_STAGED_PLAN_MISMATCH'],
      [approvalContext({ stage: 'HOLD' }), 'APPROVAL_STAGE_NOT_AUTHORIZED'],
    ];
    for (const [context, code] of cases) {
      const result = evaluateOperatorApproval(state, context, policy);
      check(id, `OLD_APPROVAL_${code}`, !result.ok && result.failure.code === code);
    }
    const world = baseWorld({ key: 'approval-drift-terminal' });
    const code = 'APPROVAL_SCOPE_DRIFT';
    return assertCausalTerminal(id, finish(id, world, {
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
      topologyExtras: { approvals: [state.approval] },
    }), code);
  }),

  scenario('CS-12', 'illegal stage jump and unauthorized add are rejected', () => {
    const id = 'CS-12';
    const evidence = { nowMs: NOW, correlationId: 'cor:illegal-stage', freshEvidence: true, reservationAvailable: true, approvalValidated: true, futureRiskRecheckRequired: true, adversePriceMoveIsSoleReason: false };
    const jump = transitionCapitalStage('OBSERVE', 'ADD', evidence);
    check(id, 'ILLEGAL_STAGE_JUMP', !jump.ok && jump.failure.code === 'ILLEGAL_CAPITAL_STAGE_TRANSITION');
    const world = baseWorld({ key: 'unauthorized-add' });
    const add = planEconomicAction({
      position: actionProjection(world.position), decision: actionDecision('ADD_STAGE'),
      controlPosture: controlPosture(), nowMs: NOW,
      idempotencyKey: 'scenario:unauthorized-add', correlationKey: 'scenario:unauthorized-add',
    });
    check(id, 'UNAUTHORIZED_ADD_REJECTED', !add.ok && ['ACTIVE_STAGE_BINDING_REQUIRED', 'STAGE_TRANSITION_AUTHORIZATION_REQUIRED'].includes(add.failure.code));
    const code = 'STAGE_TRANSITION_UNAUTHORIZED';
    return assertCausalTerminal(id, finish(id, world, {
      intents: [causalFreeze(id, world, code)],
      reports: [causalReport(world, code)],
    }), code);
  }),

  scenario('CS-13', 'pause and kill block new risk while supervision continues', () => {
    const id = 'CS-13';
    const world = baseWorld({ key: 'control-blocks-add' });
    const policy = approvalPolicy();
    const approvalState = createOperatorApprovalState(approval({ id: 'cappr_control_block' }), policy);
    const postures = ['PAUSED_NEW_EXPOSURE', 'KILL_NEW_EXPOSURE'];
    const decisions = postures.map((posture) => superviseBasis(world.position, {
      common: { controlPosture: controlPosture(posture) },
    }));
    const opening = postures.map((posture) => evaluateOperatorApproval(approvalState,
      approvalContext({ controlPosture: controlPosture(posture) }), policy));
    check(id, 'CONTROL_BLOCKS_OPEN', opening.every((item, index) => !item.ok
      && item.failure.code === (postures[index] === 'PAUSED_NEW_EXPOSURE' ? 'NEW_EXPOSURE_PAUSED' : 'NEW_EXPOSURE_KILLED')));
    check(id, 'CONTROL_BLOCKS_RISK_INCREASE', decisions.every((item) => item.intent.kind !== 'ADD_STAGE'));
    check(id, 'ACTIVE_SUPERVISION_CONTINUES', decisions.every((item) => item.priority === 'EXPOSED_CAPITAL'));
    return finish(id, world, { intents: [decisions[1].intent] });
  }),

  scenario('CS-14', 'kill still permits exit and recovery intent', () => {
    const id = 'CS-14';
    const world = baseWorld({ key: 'kill-allows-exit' });
    const policy = approvalPolicy();
    const approvalState = createOperatorApprovalState(approval({ id: 'cappr_control_reduce' }), policy);
    for (const posture of ['PAUSED_NEW_EXPOSURE', 'KILL_NEW_EXPOSURE']) {
      for (const actionClass of ['REDUCE', 'EXIT', 'RECOVERY']) {
        const result = evaluateOperatorApproval(approvalState, approvalContext({
          actionClass, controlPosture: controlPosture(posture),
        }), policy);
        check(id, `CONTROL_PERMITS_${posture}_${actionClass}`, result.ok);
      }
    }
    const decision = superviseBasis(world.position, { common: {
      controlPosture: controlPosture('KILL_NEW_EXPOSURE'),
      thesisAssessment: { invalidated: true, reasonCodes: ['SCENARIO_INVALIDATED'], conflictingEvidenceIds: ['invalidate-evidence'] },
    } });
    check(id, 'KILL_PERMITS_EXIT', decision.intent.kind === 'REQUEST_EXIT');
    check(id, 'EXIT_REDUCES_RISK', decision.intent.riskEffect === 'RISK_REDUCING');
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-15', 'one leg exposure escalates hedge then emergency recovery', () => {
    const id = 'CS-15';
    const hedgeProjected = projectedPosition('BASIS', {
      key: 'one-leg-hedge', legs: [positionLeg('one-leg-hedge:spot', 'LONG')],
      executionLifecycle: 'ONE_LEG_EXPOSED', oneLegSinceMs: NOW - 500,
    });
    const hedge = superviseBasis(hedgeProjected.position, { common: { expectedLegs: oneLegExpected(hedgeProjected.position) } });
    const emergencyProjected = projectedPosition('BASIS', {
      key: 'one-leg-emergency', legs: [positionLeg('one-leg-emergency:spot', 'LONG')],
      executionLifecycle: 'ONE_LEG_EXPOSED', oneLegSinceMs: NOW - 2_500, reconciliationStatus: 'DIVERGED',
    });
    const emergency = superviseBasis(emergencyProjected.position, { common: { expectedLegs: oneLegExpected(emergencyProjected.position) } });
    check(id, 'ONE_LEG_HEDGE_REQUESTED', hedge.intent.kind === 'REQUEST_HEDGE');
    check(id, 'ONE_LEG_EMERGENCY_ESCALATION', emergency.intent.kind === 'REQUEST_EMERGENCY_UNWIND');
    const world = baseWorld({ key: 'one-leg-terminal', projected: emergencyProjected, intent: emergency.intent });
    return finish(id, world, { intents: [emergency.intent] });
  }),

  scenario('CS-16', 'reconciliation divergence never becomes false flatness', () => {
    const id = 'CS-16';
    const projected = projectedPosition('BASIS', { key: 'reconciliation-diverged', reconciliationStatus: 'DIVERGED' });
    const decision = superviseBasis(projected.position);
    check(id, 'RECOVERY_STATE_VISIBLE', projected.position.state === 'RECOVERY_REQUIRED');
    check(id, 'EXPOSURE_NOT_FLAT', projected.position.totalGrossExposure !== '0');
    check(id, 'RECONCILIATION_FREEZES', decision.intent.kind === 'FREEZE_NEW_ACTIONS');
    const world = baseWorld({ key: 'reconciliation-terminal', projected, intent: decision.intent });
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-17', 'Basis convergence and reached target exits the thesis', () => {
    const id = 'CS-17';
    const world = baseWorld({ key: 'basis-converged' });
    const decision = superviseBasis(world.position, { common: { thesisAssessment: { targetReached: true } } });
    check(id, 'BASIS_PATH_CONVERGING', decision.checks.find((item) => item.code === 'BASIS_PATH')?.status === 'PASS');
    check(id, 'TARGET_REACHED_EXIT', decision.intent.kind === 'REQUEST_EXIT');
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-18', 'Basis widening beyond invalidation requests exit', () => {
    const id = 'CS-18';
    const world = baseWorld({ key: 'basis-widened' });
    const decision = superviseBasis(world.position, { basis: { currentExecutableBasis: '0.1' } });
    check(id, 'BASIS_DIVERGENCE_BREACH', decision.checks.find((item) => item.code === 'BASIS_DIVERGENCE')?.status === 'BREACH');
    check(id, 'BASIS_WIDENING_EXIT', decision.intent.kind === 'REQUEST_EXIT');
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-19', 'funding flip changes remaining economics and reduces exposure', () => {
    const id = 'CS-19';
    const world = baseWorld({ key: 'funding-flip' });
    const decision = superviseBasis(world.position, { basis: { funding: { rate: '0.02', direction: 'PAID', nextFundingAtMs: NOW + 1 } } });
    const report = economicReport([
      economicComponent('funding-edge', 'BASIS_CONVERGENCE_DIVERGENCE', '10'),
      economicComponent('funding-cost', 'FUNDING', '-20'),
      economicComponent('funding-residual', 'RESIDUAL_UNEXPLAINED', '0'),
    ], { positionId: world.position.id, opportunityId: world.eligibility.considerations[0].id,
      policy: { pricePnlBasis: 'BASIS_AND_DIRECTIONAL', executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE', expectedComponentKinds: ['BASIS_CONVERGENCE_DIVERGENCE', 'FUNDING', 'RESIDUAL_UNEXPLAINED'] } });
    check(id, 'FUNDING_BREACH_REDUCES', decision.intent.kind === 'REDUCE');
    check(id, 'FUNDING_FLIPS_NET_NEGATIVE', report.attribution.netKnown === '-10');
    return finish(id, world, { intents: [decision.intent], reports: [report] });
  }),

  scenario('CS-20', 'borrow cost jump reduces and unavailable borrow exits', () => {
    const id = 'CS-20';
    const world = baseWorld({ key: 'borrow-deterioration' });
    const high = superviseBasis(world.position, { basis: { borrow: { rate: '0.03' } } });
    const unavailable = superviseBasis(world.position, { basis: { borrow: { availability: 'UNAVAILABLE' } } });
    check(id, 'HIGH_BORROW_REDUCES', high.intent.kind === 'REDUCE');
    check(id, 'UNAVAILABLE_BORROW_EXITS', unavailable.intent.kind === 'REQUEST_EXIT');
    return finish(id, world, { intents: [unavailable.intent] });
  }),

  scenario('CS-21', 'spread depth and exit capacity collapse reduces exposure', () => {
    const id = 'CS-21';
    const world = baseWorld({ key: 'market-collapse' });
    const decision = superviseBasis(world.position, { common: { market: {
      executableSpreadCost: '20', availableDepth: '10', exitCapacity: '10', projectedExitCost: '20',
    } } });
    check(id, 'DEPTH_BREACH', decision.checks.find((item) => item.code === 'MARKET_DEPTH')?.status === 'BREACH');
    check(id, 'EXIT_CAPACITY_BREACH', decision.checks.find((item) => item.code === 'EXIT_CAPACITY')?.status === 'BREACH');
    check(id, 'CAPACITY_COLLAPSE_REDUCES', decision.intent.kind === 'REDUCE');
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-22', 'Volume continuation remains valid but validate only cannot add', () => {
    const id = 'CS-22';
    const projected = projectedPosition('VOLUME', { key: 'volume-continuation' });
    const decision = superviseVolume(projected.position, { volume: { calibrationMode: 'VALIDATE_ONLY' } });
    check(id, 'CONTINUATION_VALID', decision.checks.find((item) => item.code === 'VOLUME_CONTINUATION')?.status === 'PASS');
    check(id, 'VALIDATE_ONLY_HOLDS', decision.intent.kind === 'HOLD');
    const world = baseWorld({ key: 'volume-continuation-terminal', projected, intent: decision.intent,
      report: economicReport(null, { positionId: projected.position.id, strategy: 'VOLUME' }) });
    return finish(id, world, { intents: [decision.intent] });
  }),

  scenario('CS-23', 'Volume exhaustion reduces and reversal exits', () => {
    const id = 'CS-23';
    const projected = projectedPosition('VOLUME', { key: 'volume-exhaustion' });
    const exhaustion = superviseVolume(projected.position, { volume: { exhaustion: signal('PRESENT', '0.9', 'volume.exhaustion.scenario') } });
    const reversal = superviseVolume(projected.position, { volume: { reversal: signal('PRESENT', '0.9', 'volume.reversal.scenario') } });
    check(id, 'VOLUME_EXHAUSTION_REDUCES', exhaustion.intent.kind === 'REDUCE');
    check(id, 'VOLUME_REVERSAL_EXITS', reversal.intent.kind === 'REQUEST_EXIT');
    const world = baseWorld({ key: 'volume-exhaustion-terminal', projected, intent: reversal.intent,
      report: economicReport(null, { positionId: projected.position.id, strategy: 'VOLUME' }) });
    return finish(id, world, { intents: [reversal.intent] });
  }),

  scenario('CS-24', 'stale evidence freezes add without hiding position', () => {
    const id = 'CS-24';
    const world = baseWorld({ key: 'stale-evidence' });
    const staleTruth = truth('basis.stale', { source: {
      sourceTimeMs: NOW - 20_000, receivedAtMs: NOW - 19_990, maxAgeMs: 1_000,
    } });
    const decision = superviseBasis(world.position, { basis: { truth: staleTruth } });
    check(id, 'STALE_EVIDENCE_FREEZES', decision.intent.kind === 'FREEZE_NEW_ACTIONS');
    const terminal = finish(id, world, { intents: [decision.intent] });
    check(id, 'STALE_POSITION_STILL_VISIBLE', terminal.topologyProjection.exposedPositionIds.includes(world.position.id));
    return terminal;
  }),

  scenario('CS-25', 'checkpoint replay is idempotent and restart blocks unsafe adds', () => {
    const id = 'CS-25';
    const world = baseWorld({ key: 'checkpoint-restart' });
    const streamId = 'capital:scenario:checkpoint-restart';
    const reservation = {
      id: 'cres_checkpoint_scenario', allocationDecisionId: world.allocation.result.decisions[0].id,
      considerationId: world.eligibility.considerations[0].id, amount: '100', consumedAmount: '0',
      valuationAsset: 'USDT', state: 'ACTIVE', createdAtMs: NOW - 2_000,
      expiresAtMs: NOW + 500, releasedAtMs: null, revision: 1,
      idempotencyKey: 'checkpoint:reservation',
    };
    const stage = (name, sequence, maximumAdditionalExposure, maximumTotalExposure, reservationConsumption, allowedNextStages) => ({
      stage: name, sequence, maximumAdditionalExposure, maximumTotalExposure, reservationConsumption,
      prerequisites: [], economicThesisConditions: [], invalidationConditions: [], maximumTimeInStageMs: 60_000,
      requiredApprovalActions: [], requiredFutureGates: [], liquidityRequirement: null,
      maximumNakedLegAmount: '0', maximumNakedLegDurationMs: 0, stopAddingConditions: [],
      allowedNextStages, reductionConditions: name === 'REDUCE' ? ['reduce'] : [], cancellableBeforeEntry: true,
      nextStageConditions: allowedNextStages.map((targetStage) => ({ targetStage, conditions: [`${name}->${targetStage}`] })),
      skipConditions: [], unenteredCancellationConditions: ['cancel'],
    });
    const stages = [
      stage('OBSERVE', 0, '0', '0', '0', ['CONFIRM']),
      stage('CONFIRM', 1, '100', '100', '100', ['HOLD']),
      stage('HOLD', 2, '0', '100', '0', ['REDUCE']),
      stage('REDUCE', 3, '0', '50', '0', ['EXIT']),
      stage('EXIT', 4, '0', '0', '0', []),
    ];
    const planSemantic = {
      id: 'cplan_checkpoint_scenario', reservationId: reservation.id, revision: 1, stages,
      activeStage: 'HOLD', remainingReservedAmount: '100', createdAtMs: NOW - 1_900,
      expiresAtMs: NOW + 500, configRevision: 'checkpoint-config-1',
      proposalIntakeDigest: world.seed.intake.proposal.intakeDigest, valuationAsset: 'USDT',
      reservationRevision: 1, reservationConsiderationId: reservation.considerationId,
    };
    const plan = { ...planSemantic, digest: capitalDigest(planSemantic) };
    const mandateSemantic = {
      id: 'cmand_checkpoint_scenario', revision: 1, considerationId: reservation.considerationId,
      allocationDecisionId: reservation.allocationDecisionId, reservationId: reservation.id,
      stagedPlanId: plan.id, stagedPlanRevision: plan.revision, stagedPlanDigest: plan.digest,
      proposalIntakeDigest: plan.proposalIntakeDigest, configRevision: plan.configRevision,
      approvalId: null, riskDecision: null, targetMaximumExposure: '100', valuationAsset: 'USDT',
      createdAtMs: NOW - 1_800, expiresAtMs: NOW + 500,
    };
    const mandate = { ...mandateSemantic, digest: capitalDigest(mandateSemantic) };
    const thesis = { ...world.position.thesis, proposalId: world.seed.intake.proposal.sourceProposalId };
    const positionId = 'cpos_checkpoint_scenario';
    const projectionCommon = {
      id: positionId, key: 'checkpoint-position', mandateId: mandate.id, thesis,
      openedAtMs: NOW - 1_600,
    };
    const beforeFill = projectedPosition('BASIS', {
      ...projectionCommon, revision: 1, sourceState: 'ENTERING', sourceCapitalLifecycle: 'ENTERING',
      legs: [
        positionLeg('checkpoint:perp', 'SHORT', '0', { externalLifecycle: 'PLANNED' }),
        positionLeg('checkpoint:spot', 'LONG', '0', { externalLifecycle: 'PLANNED' }),
      ], executionLifecycle: 'READY', lastTransitionAtMs: NOW - 1_500,
    });
    const postFillDraft = projectedPosition('BASIS', {
      ...projectionCommon, revision: 2, sourceState: 'ACTIVE', sourceCapitalLifecycle: 'ACTIVE',
      legs: [positionLeg('checkpoint:perp', 'SHORT', '50'), positionLeg('checkpoint:spot', 'LONG', '50')],
      executionLifecycle: 'HEDGED_OPEN', lastTransitionAtMs: NOW - 500,
    });
    const intentResult = planEconomicAction({
      position: actionProjection(postFillDraft.position), decision: actionDecision('HOLD'),
      controlPosture: controlPosture(), nowMs: NOW,
      idempotencyKey: 'checkpoint:hold', correlationKey: 'checkpoint:position',
    });
    check(id, 'POST_FILL_INTENT_VALID', intentResult.ok);
    const intent = intentResult.value;
    const postFill = projectedPosition('BASIS', {
      ...projectionCommon, revision: 2, sourceState: 'ACTIVE', sourceCapitalLifecycle: 'ACTIVE',
      legs: [positionLeg('checkpoint:perp', 'SHORT', '50'), positionLeg('checkpoint:spot', 'LONG', '50')],
      executionLifecycle: 'HEDGED_OPEN', lastTransitionAtMs: NOW - 500,
      outstandingActionIntentIds: [intent.id],
    });
    const report = economicReport(null, { positionId, opportunityId: reservation.considerationId });
    const records = [
      ['RESERVATION_UPSERTED', reservation, NOW - 2_000],
      ['STAGED_PLAN_UPSERTED', plan, NOW - 1_900],
      ['MANDATE_UPSERTED', mandate, NOW - 1_800],
      ['THESIS_UPSERTED', thesis, NOW - 1_700],
      ['POSITION_UPSERTED', beforeFill.position, NOW - 1_500],
      ['POSITION_UPSERTED', postFill.position, NOW - 500],
      ['RECONCILIATION_UPSERTED', postFill.position.reconciliationReference, NOW - 40],
      ['ACTION_INTENT_UPSERTED', intent, NOW],
      ['ECONOMICS_UPSERTED', { id: 'economics-checkpoint-scenario', positionId, revision: 1, attribution: report.attribution }, NOW],
    ];
    const events = records.map(([kind, record, occurredAtMs], index) => createCapitalCheckpointEvent({
      streamId, sequence: index + 1, kind, occurredAtMs,
      correlationId: `scenario:checkpoint:${index + 1}`, record,
    }));
    const before = replayCapitalCheckpointEvents(streamId, events.slice(0, 5));
    const after = replayCapitalCheckpointEvents(streamId, events);
    const replay = replayCapitalCheckpointEvents(streamId, [...events].reverse().concat(events[5]));
    check(id, 'CHECKPOINT_REPLAY_SUCCEEDS', before.ok && after.ok && replay.ok);
    check(id, 'PRE_FILL_EXPOSURE_ZERO', before.value.positions[0].totalGrossExposure === '0');
    check(id, 'POST_FILL_EXPOSURE_RESTORED', after.value.positions[0].totalGrossExposure === '100');
    same(id, 'CHECKPOINT_DUPLICATE_IDEMPOTENT', after.value, replay.value);
    check(id, 'CHECKPOINT_SERIALIZATION_STABLE', serializeCapitalCheckpoint(after.value) === serializeCapitalCheckpoint(replay.value));
    const restarted = projectRestartSafety(after.value, { nowMs: NOW + 2_000,
      correlationId: 'scenario:restart:stale', accountTruth: truth('restart.account.stale', { source: { sourceTimeMs: NOW - 20_000, receivedAtMs: NOW - 19_990, maxAgeMs: 1_000 } }),
      reconciliationTruth: truth('restart.reconciliation.stale', { source: { sourceTimeMs: NOW - 20_000, receivedAtMs: NOW - 19_990, maxAgeMs: 1_000 } }),
      reconciliationReferences: [postFill.position.reconciliationReference] });
    check(id, 'RESTART_BLOCKS_INCREASE', restarted.safety.canOpenOrIncrease === false);
    check(id, 'RESTART_SUPERVISION_CONTINUES', restarted.safety.supervisionContinues === true);
    check(id, 'RESTART_POSITION_VISIBLE', restarted.safety.visiblePositionIds.includes(positionId));
    return finish(id, world, { positions: [postFill.position], intents: [intent], reports: [report],
      topologyExtras: { reservations: [reservation], stagedPlans: [plan], mandates: [mandate],
        checkpoint: { id: 'checkpoint-scenario', revision: after.value.revision,
          createdAtMs: NOW, recordIds: [reservation.id, plan.id, mandate.id, positionId, intent.id],
          truth: truth('checkpoint.reference') } } });
  }),

  scenario('CS-26', 'closed capital releases exactly once', () => {
    const id = 'CS-26';
    const world = baseWorld({ key: 'close-release' });
    const created = reserveWorld(world);
    const reservationId = created.mutation.reservationId;
    const consumed = reduceReservationBook(created.book, { kind: 'CONSUME', commandId: 'consume:close', reservationId, nowMs: NOW + 1, amount: '60' });
    const managed = consumed.book.reservations[0];
    check(id, 'CLOSE_CONSUMPTION_APPLIED', consumed.mutation.status === 'APPLIED');

    const mandateSemantic = {
      id: 'pending-close-release-mandate',
      revision: 1,
      considerationId: managed.reservation.considerationId,
      allocationDecisionId: managed.reservation.allocationDecisionId,
      reservationId,
      stagedPlanId: `staged-plan:${reservationId}`,
      stagedPlanRevision: 1,
      stagedPlanDigest: capitalDigest({ plan: reservationId }),
      proposalIntakeDigest: world.seed.intake.proposal.intakeDigest,
      configRevision: 'cfg-close-release',
      approvalId: null,
      riskDecision: null,
      targetMaximumExposure: managed.reservation.amount,
      valuationAsset: managed.reservation.valuationAsset,
      createdAtMs: NOW + 1,
      expiresAtMs: managed.reservation.expiresAtMs,
    };
    mandateSemantic.id = deriveCapitalMandateId({
      considerationId: mandateSemantic.considerationId,
      allocationDecisionId: mandateSemantic.allocationDecisionId,
      reservationId: mandateSemantic.reservationId,
      proposalIntakeDigest: mandateSemantic.proposalIntakeDigest,
    });
    const mandate = { ...mandateSemantic, digest: capitalDigest(mandateSemantic) };
    const closeTruth = truth('scenario.close-release', {
      evaluatedAtMs: NOW + 4,
      source: { sourceTimeMs: NOW + 2, receivedAtMs: NOW + 3, maxAgeMs: 10_000 },
    });
    const closedProjection = projectedPosition('BASIS', {
      key: 'close-release-proof',
      revision: 4,
      mandateId: mandate.id,
      thesis: {
        ...world.position.thesis,
        proposalId: world.seed.intake.proposal.sourceProposalId,
        openedAtMs: NOW + 1,
        configRevision: mandate.configRevision,
      },
      sourceState: 'CLOSED',
      sourceCapitalLifecycle: 'CLOSED',
      legs: [
        positionLeg('close-release:perpetual', 'SHORT', '0', { externalLifecycle: 'FILLED', truth: closeTruth }),
        positionLeg('close-release:spot', 'LONG', '0', { externalLifecycle: 'FILLED', truth: closeTruth }),
      ],
      executionLifecycle: 'CLOSED',
      executionState: {
        observedAtMs: NOW + 3, sequence: 10, revision: 'close-execution-r10', truth: closeTruth,
      },
      reconciliationStatus: 'EXACT',
      reconciliationState: {
        observedAtMs: NOW + 4, sequence: 11, revision: 'close-reconciliation-r11', truth: closeTruth,
      },
      outstandingActionIntentIds: [],
      openedAtMs: NOW + 1,
      lastTransitionAtMs: NOW + 2,
      truth: closeTruth,
      projectedAtMs: NOW + 4,
    });
    check(id, 'CLOSED_POSITION_CANONICAL',
      closedProjection.position.state === 'CLOSED'
      && closedProjection.position.capitalLifecycle === 'CLOSED'
      && closedProjection.position.totalGrossExposure === '0'
      && closedProjection.position.reconciliationReference?.status === 'EXACT');
    const closure = {
      reservationId,
      allocationDecisionId: managed.reservation.allocationDecisionId,
      considerationId: managed.reservation.considerationId,
      capitalClaimKey: managed.capitalClaimKey,
      reservationRevision: managed.reservation.revision,
      consumedAmount: managed.reservation.consumedAmount,
      mandate,
      position: closedProjection.position,
    };
    const closed = reduceReservationBook(consumed.book, {
      kind: 'CLOSE_RELEASE', commandId: 'close:first', reservationId, nowMs: NOW + 5, closure,
    });
    check(id, 'CLOSE_PROOF_ACCEPTED', closed.mutation.status === 'APPLIED', closed.mutation.reasonCodes.join(','));
    const repeated = reduceReservationBook(closed.book, {
      kind: 'CLOSE_RELEASE', commandId: 'close:second', reservationId, nowMs: NOW + 6, closure,
    });
    check(id, 'CLOSE_RELEASES_FULL_CLAIM', closed.mutation.releasedAmount === managed.reservation.amount);
    check(id, 'CLOSE_RELEASE_ONCE', repeated.mutation.status === 'NOOP_ALREADY_TERMINAL' && repeated.mutation.releasedAmount === '0');
    return finish(id, world, {
      topologyExtras: {
        reservations: closed.book.reservations.map((item) => item.reservation),
        mandates: [mandate],
      },
    });
  }),

  scenario('CS-27', 'all economic families sum with exact decimal identity', () => {
    const id = 'CS-27';
    const world = baseWorld({ key: 'economic-identity' });
    const components = [
      economicComponent('basis', 'BASIS_CONVERGENCE_DIVERGENCE', '9'),
      economicComponent('directional', 'DIRECTIONAL_CONTRIBUTION', '3'),
      economicComponent('fees', 'TRADING_COMMISSIONS', '-2'),
      economicComponent('entry-spread', 'ENTRY_SPREAD_COST', '-1'),
      economicComponent('exit-spread', 'EXIT_SPREAD_COST', '-1'),
      economicComponent('slippage', 'REALIZED_SLIPPAGE', '-1'),
      economicComponent('funding', 'FUNDING', '-1'),
      economicComponent('borrow', 'BORROW_INTEREST_AND_FEES', '-1'),
      economicComponent('one-leg-na', 'ONE_LEG_EXPOSURE', null, { status: 'NOT_APPLICABLE', sourceIds: [], reasonCodes: ['NOT_APPLICABLE'] }),
      economicComponent('conversion-na', 'CONVERSION_VALUATION', null, { status: 'NOT_APPLICABLE', sourceIds: [], reasonCodes: ['NOT_APPLICABLE'] }),
      economicComponent('recovery-na', 'OPERATIONAL_RECOVERY_COST', null, { status: 'NOT_APPLICABLE', sourceIds: [], reasonCodes: ['NOT_APPLICABLE'] }),
      economicComponent('residual', 'RESIDUAL_UNEXPLAINED', '0'),
    ];
    const report = economicReport(components, { positionId: world.position.id,
      opportunityId: world.eligibility.considerations[0].id,
      policy: { pricePnlBasis: 'BASIS_AND_DIRECTIONAL', executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE', expectedComponentKinds: components.map((item) => item.kind) } });
    check(id, 'EXACT_ECONOMIC_SUM', report.attribution.netKnown === '5');
    check(id, 'ACCOUNTING_IDENTITY_PROVEN', report.identity.proven === true && report.identity.knownComponentSum === '5');
    return finish(id, world, { reports: [report] });
  }),

  scenario('CS-28', 'missing valuation or cost stays incomplete rather than zero', () => {
    const id = 'CS-28';
    const world = baseWorld({ key: 'economic-missing' });
    const report = economicReport([
      economicComponent('known-fee', 'TRADING_COMMISSIONS', '-2'),
      economicComponent('missing-borrow', 'BORROW_INTEREST_AND_FEES', null, { status: 'MISSING', observedAtMs: null, reasonCodes: ['BORROW_SOURCE_MISSING'] }),
      economicComponent('missing-valuation', 'CONVERSION_VALUATION', null, { status: 'MISSING', observedAtMs: null, reasonCodes: ['VALUATION_SOURCE_MISSING'] }),
    ], { positionId: world.position.id, opportunityId: world.eligibility.considerations[0].id });
    check(id, 'MISSING_COST_NOT_ZERO', report.measures.borrow.knownAmount === null);
    check(id, 'MISSING_VALUATION_NOT_ZERO', report.measures.fxValuation.knownAmount === null);
    check(id, 'PNL_INCOMPLETE', report.attribution.completeness !== 'COMPLETE' && report.attribution.accountingIdentityProven === false);
    return finish(id, world, { reports: [report] });
  }),

  scenario('CS-29', 'topology identifies reconciliation as the root cause', () => {
    const id = 'CS-29';
    const projected = projectedPosition('BASIS', { key: 'root-cause', reconciliationStatus: 'DIVERGED' });
    const decision = superviseBasis(projected.position);
    const world = baseWorld({ key: 'root-cause-terminal', projected, intent: decision.intent });
    const terminal = finish(id, world, { intents: [decision.intent] });
    const positionNode = terminal.topologyProjection.nodes.find((node) => node.kind === 'POSITION' && node.sourceId === projected.position.id);
    const reconciliationNode = terminal.topologyProjection.nodes.find((node) => node.kind === 'RECONCILIATION' && node.sourceId === projected.position.reconciliationReference.id);
    check(id, 'ROOT_CAUSE_NODES_EXIST', positionNode && reconciliationNode);
    check(id, 'RECONCILIATION_ROOT_CAUSE', positionNode.rootCauseNodeIds.includes(reconciliationNode.id));
    check(id, 'ROOT_CAUSE_CATEGORY', positionNode.effectiveBlockCategories.includes('RECONCILIATION_DIVERGENCE'));
    return terminal;
  }),

  scenario('CS-30', 'exposed recovery outranks routine and unopened score', () => {
    const id = 'CS-30';
    const recoveryProjected = projectedPosition('BASIS', { key: 'priority-recovery',
      legs: [positionLeg('priority-recovery:spot', 'LONG')], executionLifecycle: 'ONE_LEG_EXPOSED',
      oneLegSinceMs: NOW - 2_500, reconciliationStatus: 'DIVERGED' });
    const recovery = superviseBasis(recoveryProjected.position, { common: { expectedLegs: oneLegExpected(recoveryProjected.position) } });
    const routineProjected = projectedPosition('VOLUME', { key: 'priority-routine' });
    const routine = superviseVolume(routineProjected.position, { volume: { calibrationMode: 'VALIDATE_ONLY' } });
    const world = baseWorld({ key: 'priority-terminal' });
    const reports = [
      economicReport(null, { positionId: recoveryProjected.position.id }),
      economicReport(null, { positionId: routineProjected.position.id, strategy: 'VOLUME' }),
    ];
    const terminal = finish(id, world, { positions: [routineProjected.position, recoveryProjected.position],
      intents: [routine.intent, recovery.intent], reports });
    check(id, 'RECOVERY_IS_EMERGENCY', recovery.intent.urgency === 'EMERGENCY');
    check(id, 'RECOVERY_CRITICAL_PATH_FIRST', terminal.topologyProjection.criticalPaths[0].positionId === recoveryProjected.position.id);
    const firstAttention = terminal.topologyProjection.nodes.find((node) => node.id === terminal.topologyProjection.attentionNodeIds[0]);
    check(id, 'EXPOSED_CAPITAL_BEFORE_UNOPENED', firstAttention?.capitalExposed === true);
    return terminal;
  }),
]);

export function runCapitalSupervisionScenario(entry) {
  try {
    return entry.run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes(`${entry.id} invariant=`)) throw error;
    fail(entry.id, 'SCENARIO_EXECUTION', detail);
  }
}
