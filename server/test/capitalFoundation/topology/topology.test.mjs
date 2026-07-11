import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPITAL_BLOCK_CATEGORIES,
  CAPITAL_TOPOLOGY_EDGE_KINDS,
  CAPITAL_TOPOLOGY_NODE_KINDS,
  projectActiveCapitalTopology,
} from '../../../dist/capitalFoundation/topology/index.js';
import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';
import { canonicalJson } from '../../../dist/foundation/contracts/index.js';
import { buildOfficialMandateFixture } from '../checkpoint/officialMandateFixture.mjs';

const NOW = 1_900_000_000_000;
function truth({ stale = false, divergent = false } = {}) {
  return assessCapitalTruth({ source: { sourceTimeMs: stale ? NOW - 5_000 : NOW - 10, receivedAtMs: NOW - 5,
    maxAgeMs: 1_000, authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'topology.test' },
  evaluatedAtMs: NOW, requiredValuePresent: true, divergent });
}
const proposal = { sourceProposalId: 'proposal-1', canonicalProposalId: 'canonical-1', sourceCorrelationId: 'source-cor-1',
  strategy: 'BASIS', symbol: 'BTCUSDT', direction: 'long_spot_short_perp', sourceLifecycle: 'open', sourceRevision: null,
  sourceConfigRevision: null, createdAtMs: NOW - 5_000, updatedAtMs: NOW - 1_000, expiresAtMs: NOW + 5_000, intakeDigest: 'intake-1' };
const consideration = { id: 'consideration-1', proposal, mode: 'EXECUTABLE', status: 'ELIGIBLE', reasons: [], legs: [],
  economics: {}, evidencePacketIds: ['evidence-1'], evidenceTruth: 'COMPLETE', truth: truth(), conflictingConsiderationIds: [], evaluatedAtMs: NOW - 900 };
const allocation = { id: 'allocation-1', considerationId: consideration.id, status: 'GRANTED', requestedAmount: '100', grantedAmount: '100',
  valuationAsset: 'USDT', priorityKey: 'priority-1', policyRevision: 'cfg-1', audit: [], blockingReasons: [], decidedAtMs: NOW - 800 };
const reservation = { id: 'reservation-1', allocationDecisionId: allocation.id, considerationId: consideration.id, amount: '100',
  consumedAmount: '100', valuationAsset: 'USDT', state: 'ACTIVE', createdAtMs: NOW - 700, expiresAtMs: NOW + 5_000,
  releasedAtMs: null, revision: 1, idempotencyKey: 'res-1' };
const plan = { id: 'plan-1', reservationId: reservation.id, revision: 1, digest: 'plan-digest', stages: [{ stage: 'HOLD', sequence: 1 }],
  activeStage: 'HOLD', remainingReservedAmount: '0', createdAtMs: NOW - 600, expiresAtMs: NOW + 5_000 };
const mandate = { id: 'mandate-1', revision: 1, digest: 'mandate-digest', considerationId: consideration.id,
  allocationDecisionId: allocation.id, reservationId: reservation.id, stagedPlanId: plan.id, stagedPlanRevision: 1,
  stagedPlanDigest: plan.digest, proposalIntakeDigest: proposal.intakeDigest, configRevision: 'cfg-1', approvalId: null,
  riskDecision: null, targetMaximumExposure: '100', valuationAsset: 'USDT', createdAtMs: NOW - 500, expiresAtMs: NOW + 5_000 };
const approval = { id: 'approval-1', proposalId: proposal.sourceProposalId, mandateId: mandate.id, stagedPlanId: plan.id,
  proposalIntakeDigest: mandate.proposalIntakeDigest, mandateRevision: mandate.revision, mandateDigest: mandate.digest,
  stagedPlanRevision: mandate.stagedPlanRevision, stagedPlanDigest: mandate.stagedPlanDigest,
  configRevision: mandate.configRevision, valuationAsset: mandate.valuationAsset, maximumNotional: '100',
  mode: 'MANUAL_ARMED', issuedAtMs: NOW - 450, expiresAtMs: NOW + 5_000, revokedAtMs: null };
const risk = { decisionId: 'risk-1', mandateId: mandate.id, externalPlanId: 'external-plan-1',
  verdict: { allowed: true, evaluatedAt: NOW - 400, expiresAt: NOW + 5_000, blockingCodes: [] } };
const recon = { id: 'recon-1', externalPlanId: 'external-plan-1', correlationId: 'execution-1', status: 'DIVERGED',
  observedAtMs: NOW - 100, sequence: 2, revision: 'recon-2', reasonCodes: ['CHECKPOINT_VENUE_MISMATCH'], truth: truth({ divergent: true }) };
const position = { id: 'position-1', revision: 1, mandateId: mandate.id,
  thesis: { id: 'thesis-1', revision: 1, proposalId: proposal.sourceProposalId, originalEvidenceIds: ['evidence-1'], openedAtMs: NOW - 300 },
  state: 'RECOVERY_REQUIRED', capitalLifecycle: 'RECOVERY_REQUIRED', legs: [{ id: 'leg-1', instrumentId: 'BTCUSDT', symbol: 'BTCUSDT',
    side: 'LONG', quantity: '1', quoteExposure: '100', valuationAsset: 'USDT', externalLifecycle: 'AMBIGUOUS', truth: truth() }],
  totalGrossExposure: '100', netDirectionalExposure: '100', hedgeRatio: null, oneLegExposure: '100', oneLegSinceMs: NOW - 200,
  reconciliationReference: recon, executionReference: null, outstandingActionIntentIds: ['intent-1'],
  openedAtMs: NOW - 300, lastTransitionAtMs: NOW - 50, truth: truth({ divergent: true }) };
const intent = { id: 'intent-1', positionId: position.id, kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY',
  blockingFacts: ['ONE_LEG_EXPOSURE'], hardDeadlineMs: null, createdAtMs: NOW - 40 };
const economics = { id: 'economics-1', positionId: position.id, revision: 1, attribution: { accountingIdentityProven: false,
  completeness: 'DIVERGENT', divergentReasons: ['RESIDUAL_UNEXPLAINED'], missingComponentKinds: ['RESIDUAL_UNEXPLAINED'], evaluatedAtMs: NOW - 30 } };

function fixture(overrides = {}) {
  return { evaluatedAtMs: NOW, proposals: [proposal], evidence: [{ id: 'evidence-1', status: 'CURRENT', truth: truth(), lastTransitionAtMs: NOW - 1_000, reasonCodes: [] }],
    considerations: [consideration], allocationDecisions: [allocation], reservations: [reservation], mandates: [mandate], stagedPlans: [plan],
    approvals: [approval], riskDecisions: [risk], executionReferences: [], positions: [position], reconciliationReferences: [recon],
    supervisionDecisions: [{ id: 'supervision-1', positionId: position.id, positionRevision: position.revision,
      thesisRevision: position.thesis.revision, status: 'RECOVERY', truth: truth(), lastTransitionAtMs: NOW - 20,
      reasonCodes: ['ONE_LEG_EXPOSURE'], actionIntentIds: [intent.id] }], intents: [intent], economics: [economics],
    checkpoint: { id: 'checkpoint-1', revision: 11, createdAtMs: NOW - 10, recordIds: [position.id, intent.id], truth: truth() }, truthReferences: [], ...overrides };
}

test('topology emits every required operator node family with stable IDs', () => {
  const graph = projectActiveCapitalTopology(fixture());
  for (const kind of ['STRATEGY_PROPOSAL', 'EVIDENCE', 'CAPITAL_BUDGET', 'RESERVATION', 'MANDATE', 'STAGE', 'APPROVAL',
    'FUTURE_RISK', 'POSITION', 'POSITION_LEG', 'RECONCILIATION', 'SUPERVISION', 'ACTION_INTENT', 'ECONOMICS', 'CHECKPOINT']) {
    assert.ok(graph.nodes.some((node) => node.kind === kind), `missing ${kind}`);
  }
  assert.equal(graph.id, projectActiveCapitalTopology(fixture()).id);
  assert.ok(graph.nodes.every((node) => node.id.startsWith('ctn_')));
  assert.ok(graph.edges.every((edge) => edge.id.startsWith('cte_')));
});

test('official mandate with dormant approvalId resolves exact approval-side authority without a false missing node', () => {
  const official = buildOfficialMandateFixture(NOW);
  assert.equal(official.mandate.approvalId, null);
  const graph = projectActiveCapitalTopology(fixture({
    proposals: [official.proposal], considerations: [], allocationDecisions: [], reservations: [official.reservation],
    mandates: [official.mandate], stagedPlans: [official.plan], approvals: [official.approval], riskDecisions: [],
    positions: [], reconciliationReferences: [], supervisionDecisions: [], intents: [], economics: [], checkpoint: null,
  }));
  const mandateNode = graph.nodes.find((node) => node.kind === 'MANDATE' && node.sourceId === official.mandate.id);
  const approvalNode = graph.nodes.find((node) => node.kind === 'APPROVAL' && node.sourceId === official.approval.id);
  assert.ok(mandateNode);
  assert.ok(approvalNode);
  assert.equal(graph.nodes.some((node) => node.kind === 'APPROVAL' && node.sourceId === `${official.mandate.id}:approval`), false);
  assert.ok(graph.edges.some((edge) => edge.kind === 'AUTHORIZES' && edge.from === approvalNode.id && edge.to === mandateNode.id));
});

test('approval-side mandate authority fails closed for every stale exact binding', () => {
  const official = buildOfficialMandateFixture(NOW);
  const hostileApprovals = [
    { ...official.approval, mandateRevision: official.mandate.revision + 1 },
    { ...official.approval, mandateDigest: 'stale-mandate-digest' },
    { ...official.approval, stagedPlanId: 'stale-plan-id' },
    { ...official.approval, stagedPlanRevision: official.plan.revision + 1 },
    { ...official.approval, stagedPlanDigest: 'stale-plan-digest' },
    { ...official.approval, proposalIntakeDigest: 'stale-proposal-digest' },
    { ...official.approval, configRevision: 'stale-config-revision' },
  ];
  for (const hostile of hostileApprovals) {
    const graph = projectActiveCapitalTopology(fixture({
      proposals: [official.proposal], considerations: [], allocationDecisions: [], reservations: [official.reservation],
      mandates: [official.mandate], stagedPlans: [official.plan], approvals: [hostile], riskDecisions: [], positions: [],
      reconciliationReferences: [], supervisionDecisions: [], intents: [], economics: [], checkpoint: null,
    }));
    const mandateNode = graph.nodes.find((node) => node.kind === 'MANDATE' && node.sourceId === official.mandate.id);
    const approvalNode = graph.nodes.find((node) => node.kind === 'APPROVAL' && node.sourceId === hostile.id);
    const missing = graph.nodes.find((node) => node.kind === 'APPROVAL' && node.sourceId === `${official.mandate.id}:approval`);
    assert.ok(missing, JSON.stringify(hostile));
    assert.equal(missing.status, 'MISSING');
    assert.equal(graph.edges.some((edge) => edge.kind === 'AUTHORIZES' && edge.from === approvalNode.id && edge.to === mandateNode.id), false);
  }
});

test('topology public vocabulary arrays are immutable', () => {
  assert.equal(Object.isFrozen(CAPITAL_TOPOLOGY_NODE_KINDS), true);
  assert.equal(Object.isFrozen(CAPITAL_TOPOLOGY_EDGE_KINDS), true);
  assert.equal(Object.isFrozen(CAPITAL_BLOCK_CATEGORIES), true);
});

test('reconciliation divergence propagates to its exposed position without killing unrelated opportunity nodes', () => {
  const graph = projectActiveCapitalTopology(fixture({ proposals: [proposal, { ...proposal, sourceProposalId: 'proposal-unrelated', canonicalProposalId: 'canonical-2', intakeDigest: 'intake-2' }] }));
  const positionNode = graph.nodes.find((node) => node.sourceId === position.id);
  const reconNode = graph.nodes.find((node) => node.sourceId === recon.id);
  const unrelated = graph.nodes.find((node) => node.sourceId === 'proposal-unrelated');
  assert.ok(positionNode.effectiveBlockCategories.includes('RECONCILIATION_DIVERGENCE'));
  assert.ok(positionNode.rootCauseNodeIds.includes(reconNode.id));
  assert.equal(unrelated.effectiveBlockCategories.includes('RECONCILIATION_DIVERGENCE'), false);
  assert.deepEqual(unrelated.effectiveBlockCategories, ['TRUTH_DEGRADATION']);
  assert.notEqual(graph.status, 'DEAD');
});

test('critical path exists per exposed position and prioritizes recovery urgency', () => {
  const graph = projectActiveCapitalTopology(fixture());
  assert.equal(graph.criticalPaths.length, 1);
  assert.equal(graph.criticalPaths[0].positionId, position.id);
  assert.equal(graph.criticalPaths[0].status, 'RECOVERY_REQUIRED');
  assert.equal(graph.criticalPaths[0].urgency, 'EMERGENCY');
  assert.ok(graph.criticalPaths[0].nodeIds.length >= 10);
  assert.deepEqual(graph.exposedPositionIds, [position.id]);
});

test('precise block categories distinguish risk, approval, capital, strategy, execution, reconciliation, and economics', () => {
  const blocked = fixture({
    proposals: [{ ...proposal, sourceLifecycle: 'rejected' }],
    allocationDecisions: [{ ...allocation, status: 'BLOCKED', blockingReasons: ['LIMIT'] }],
    approvals: [{ ...approval, revokedAtMs: NOW - 1 }],
    riskDecisions: [{ ...risk, verdict: { ...risk.verdict, allowed: false, blockingCodes: ['RISK_LIMIT'] } }],
  });
  const categories = new Set(projectActiveCapitalTopology(blocked).nodes.map((node) => node.directBlockCategory));
  for (const category of ['STRATEGY_REJECTION', 'CAPITAL_BLOCK', 'APPROVAL_BLOCK', 'RISK_BLOCK',
    'EXECUTION_UNCERTAINTY', 'RECONCILIATION_DIVERGENCE', 'ECONOMIC_INVALIDATION']) assert.ok(categories.has(category), category);
});

test('missing truth is explicitly degraded rather than healthy', () => {
  const graph = projectActiveCapitalTopology(fixture({ truthReferences: [] }));
  const reservationNode = graph.nodes.find((node) => node.sourceId === reservation.id);
  assert.equal(reservationNode.freshness, 'UNKNOWN');
  assert.equal(reservationNode.completeness, 'UNKNOWN');
  assert.ok(reservationNode.degradedReasons.includes('TRUTH_NOT_SUPPLIED'));
  assert.equal(reservationNode.directBlockCategory, 'TRUTH_DEGRADATION');
  assert.ok(reservationNode.rootCauseNodeIds.includes(reservationNode.id));
});

test('cached FRESH truth is re-aged at topology evaluation time and becomes a root cause', () => {
  const cachedFresh = truth();
  const graph = projectActiveCapitalTopology(fixture({
    evaluatedAtMs: NOW + 2_000,
    evidence: [{
      id: 'evidence-1',
      status: 'CURRENT',
      truth: cachedFresh,
      lastTransitionAtMs: NOW - 1_000,
      reasonCodes: [],
    }],
  }));
  const evidenceNode = graph.nodes.find((node) => node.sourceId === 'evidence-1');
  assert.equal(cachedFresh.freshness.state, 'FRESH', 'fixture must prove the supplied label was cached fresh');
  assert.equal(evidenceNode.freshness, 'STALE');
  assert.equal(evidenceNode.completeness, 'STALE');
  assert.equal(evidenceNode.directBlockCategory, 'TRUTH_DEGRADATION');
  assert.ok(evidenceNode.degradedReasons.includes('FRESHNESS_STALE'));
  assert.ok(evidenceNode.rootCauseNodeIds.includes(evidenceNode.id));
});

test('input order changes do not change canonical topology output', () => {
  const unrelatedProposal = { ...proposal, sourceProposalId: 'proposal-unrelated-order', canonicalProposalId: 'canonical-order', intakeDigest: 'intake-order' };
  const unrelatedEvidence = { id: 'evidence-unrelated-order', status: 'CURRENT', truth: truth(), lastTransitionAtMs: NOW - 800, reasonCodes: [] };
  const first = projectActiveCapitalTopology(fixture({ proposals: [proposal, unrelatedProposal],
    evidence: [fixture().evidence[0], unrelatedEvidence] }));
  const second = projectActiveCapitalTopology(fixture({ proposals: [unrelatedProposal, proposal],
    evidence: [unrelatedEvidence, fixture().evidence[0]] }));
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test('attention queue places exposed capital before unopened degradation', () => {
  const graph = projectActiveCapitalTopology(fixture({ proposals: [{ ...proposal, sourceLifecycle: 'rejected' }] }));
  const first = graph.nodes.find((node) => node.id === graph.attentionNodeIds[0]);
  assert.equal(first.capitalExposed, true);
  assert.equal(graph.status, 'ATTENTION_REQUIRED');
});

test('duplicate topology identities are rejected instead of becoming input-order dependent', () => {
  const duplicate = { ...proposal, sourceLifecycle: 'rejected', updatedAtMs: NOW - 1 };
  assert.throws(() => projectActiveCapitalTopology(fixture({ proposals: [proposal, duplicate] })),
    /duplicate topology node identity STRATEGY_PROPOSAL:proposal-1/);
  assert.throws(() => projectActiveCapitalTopology(fixture({ proposals: [duplicate, proposal] })),
    /duplicate topology node identity STRATEGY_PROPOSAL:proposal-1/);
});

test('unknown and partial exposed-leg lifecycle is execution uncertainty, never operational', () => {
  for (const externalLifecycle of [null, 'PARTIALLY_FILLED']) {
    const uncertainPosition = { ...position, state: 'ACTIVE', capitalLifecycle: 'ACTIVE', oneLegExposure: '100',
      legs: [{ ...position.legs[0], externalLifecycle }] };
    const graph = projectActiveCapitalTopology(fixture({ positions: [uncertainPosition] }));
    const legNode = graph.nodes.find((node) => node.sourceId === position.legs[0].id);
    const positionNode = graph.nodes.find((node) => node.sourceId === position.id);
    assert.equal(legNode.directBlockCategory, 'EXECUTION_UNCERTAINTY');
    assert.equal(positionNode.directBlockCategory, 'EXECUTION_UNCERTAINTY');
    assert.equal(graph.criticalPaths[0].status, 'BLOCKED');
    assert.equal(graph.criticalPaths[0].urgency, 'EMERGENCY');
    assert.equal(graph.status, 'ATTENTION_REQUIRED');
  }
});

test('unknown lifecycle, state, status, and stage vocabularies are explicit blockers', () => {
  const hostileInputs = [
    {
      key: 'execution-unknown', sourceId: 'execution-unknown', reason: 'EXECUTION_LIFECYCLE_INVALID',
      overrides: { executionReferences: [{ id: 'execution-unknown', externalPlanId: 'external-plan-1', correlationId: 'execution-1',
        lifecycle: 'MYSTERY_EXECUTION', observedAtMs: NOW - 5, sequence: 1, revision: 'exec-r1', truth: truth() }] },
    },
    {
      key: position.id, sourceId: position.id, reason: 'POSITION_STATE_INVALID',
      overrides: { positions: [{ ...position, state: 'MYSTERY_POSITION' }] },
    },
    {
      key: consideration.id, sourceId: consideration.id, reason: 'ELIGIBILITY_STATUS_INVALID',
      overrides: { considerations: [{ ...consideration, status: 'MYSTERY_ELIGIBILITY' }] },
    },
    {
      key: plan.id, sourceId: plan.id, reason: 'STAGED_PLAN_ACTIVE_STAGE_INVALID',
      overrides: { stagedPlans: [{ ...plan, activeStage: 'MYSTERY_STAGE' }] },
    },
    {
      key: recon.id, sourceId: recon.id, reason: 'RECONCILIATION_STATUS_INVALID',
      overrides: { reconciliationReferences: [{ ...recon, status: 'MYSTERY_RECONCILIATION' }] },
    },
  ];
  for (const hostile of hostileInputs) {
    const graph = projectActiveCapitalTopology(fixture(hostile.overrides));
    const node = graph.nodes.find((item) => item.sourceId === hostile.sourceId);
    assert.ok(node, hostile.key);
    assert.notEqual(node.directBlockCategory, 'NONE', hostile.key);
    assert.ok(node.blockingReasons.includes(hostile.reason), hostile.key);
    assert.ok(node.degradedReasons.includes(hostile.reason), hostile.key);
  }
});

test('invalid and noninteger expiry or observed times never project CURRENT or healthy', () => {
  const executionReference = { id: 'execution-invalid-time', externalPlanId: 'external-plan-1', correlationId: 'execution-1',
    lifecycle: 'HEDGED_OPEN', observedAtMs: NOW + 0.5, sequence: 1, revision: 'exec-r1', truth: truth() };
  const cases = [
    { sourceId: reservation.id, reason: 'RESERVATION_TIME_WINDOW_INVALID', overrides: { reservations: [{ ...reservation, expiresAtMs: NOW + 0.5 }] } },
    { sourceId: plan.id, reason: 'STAGED_PLAN_TIME_WINDOW_INVALID', overrides: { stagedPlans: [{ ...plan, expiresAtMs: NOW + 0.5 }] } },
    { sourceId: mandate.id, reason: 'MANDATE_TIME_WINDOW_INVALID', overrides: { mandates: [{ ...mandate, expiresAtMs: NOW + 0.5 }] } },
    { sourceId: approval.id, reason: 'APPROVAL_TIME_WINDOW_INVALID', overrides: { approvals: [{ ...approval, expiresAtMs: NOW + 0.5 }] } },
    { sourceId: executionReference.id, reason: 'EXECUTION_OBSERVED_AT_INVALID', overrides: { executionReferences: [executionReference] } },
    { sourceId: position.id, reason: 'POSITION_TRANSITION_TIME_INVALID', overrides: { positions: [{ ...position, lastTransitionAtMs: NOW + 1 }] } },
  ];
  for (const hostile of cases) {
    const graph = projectActiveCapitalTopology(fixture(hostile.overrides));
    const node = graph.nodes.find((item) => item.sourceId === hostile.sourceId);
    assert.ok(node, hostile.sourceId);
    assert.notEqual(node.directBlockCategory, 'NONE', hostile.sourceId);
    assert.ok(node.blockingReasons.includes(hostile.reason), hostile.sourceId);
    assert.notEqual(node.status, 'CURRENT', hostile.sourceId);
  }
});

test('zero or noninteger revisions are visible blockers across topology records', () => {
  const cases = [
    { sourceId: reservation.id, reason: 'RESERVATION_REVISION_INVALID', overrides: { reservations: [{ ...reservation, revision: 0 }] } },
    { sourceId: plan.id, reason: 'STAGED_PLAN_REVISION_INVALID', overrides: { stagedPlans: [{ ...plan, revision: 0 }] } },
    { sourceId: mandate.id, reason: 'MANDATE_REVISION_INVALID', overrides: { mandates: [{ ...mandate, revision: 0 }] } },
    { sourceId: position.id, reason: 'POSITION_REVISION_INVALID', overrides: { positions: [{ ...position, revision: 0 }] } },
    { sourceId: economics.id, reason: 'ECONOMICS_REVISION_INVALID', overrides: { economics: [{ ...economics, revision: 1.5 }] } },
    { sourceId: 'checkpoint-1', reason: 'CHECKPOINT_REVISION_INVALID', overrides: { checkpoint: { ...fixture().checkpoint, revision: 0 } } },
  ];
  for (const hostile of cases) {
    const graph = projectActiveCapitalTopology(fixture(hostile.overrides));
    const node = graph.nodes.find((item) => item.sourceId === hostile.sourceId);
    assert.ok(node, hostile.sourceId);
    assert.notEqual(node.directBlockCategory, 'NONE', hostile.sourceId);
    assert.ok(node.blockingReasons.includes(hostile.reason), hostile.sourceId);
  }
});

test('malformed exact exposure facts never throw or disappear from operator topology', () => {
  const zeroPosition = {
    ...position,
    state: 'ACTIVE',
    capitalLifecycle: 'ACTIVE',
    totalGrossExposure: '0',
    netDirectionalExposure: '0',
    hedgeRatio: null,
    oneLegExposure: '0',
    oneLegSinceMs: null,
    legs: [{ ...position.legs[0], quantity: '0', quoteExposure: '0', externalLifecycle: 'FILLED' }],
    reconciliationReference: null,
    outstandingActionIntentIds: [],
    truth: truth(),
  };
  const cases = [
    { reason: 'POSITION_TOTAL_GROSS_EXPOSURE_INVALID', mutate: (item) => ({ ...item, totalGrossExposure: '-1' }), nodeKind: 'POSITION' },
    { reason: 'POSITION_TOTAL_GROSS_EXPOSURE_INVALID', mutate: (item) => ({ ...item, totalGrossExposure: '1e2' }), nodeKind: 'POSITION' },
    { reason: 'POSITION_ONE_LEG_EXPOSURE_INVALID', mutate: (item) => ({ ...item, oneLegExposure: '01' }), nodeKind: 'POSITION' },
    { reason: 'POSITION_NET_DIRECTIONAL_EXPOSURE_INVALID', mutate: (item) => ({ ...item, netDirectionalExposure: '0.0' }), nodeKind: 'POSITION' },
    { reason: 'POSITION_HEDGE_RATIO_INVALID', mutate: (item) => ({ ...item, hedgeRatio: '+1' }), nodeKind: 'POSITION' },
    { reason: 'LEG_QUOTE_EXPOSURE_INVALID', mutate: (item) => ({ ...item,
      legs: [{ ...item.legs[0], quoteExposure: '1.0' }] }), nodeKind: 'POSITION_LEG' },
    { reason: 'LEG_QUANTITY_INVALID', mutate: (item) => ({ ...item,
      legs: [{ ...item.legs[0], quantity: '-1' }] }), nodeKind: 'POSITION_LEG' },
  ];
  for (const hostile of cases) {
    const malformed = hostile.mutate(zeroPosition);
    let graph;
    assert.doesNotThrow(() => { graph = projectActiveCapitalTopology(fixture({
      positions: [malformed],
      reconciliationReferences: [],
      supervisionDecisions: [],
      intents: [],
      economics: [],
      checkpoint: null,
    })); }, hostile.reason);
    const node = graph.nodes.find((item) => item.kind === hostile.nodeKind
      && item.sourceId === (hostile.nodeKind === 'POSITION' ? malformed.id : malformed.legs[0].id));
    assert.ok(node, hostile.reason);
    assert.ok(node.blockingReasons.includes(hostile.reason), hostile.reason);
    assert.ok(node.degradedReasons.includes(hostile.reason), hostile.reason);
    assert.notEqual(node.directBlockCategory, 'NONE', hostile.reason);
    assert.ok(graph.exposedPositionIds.includes(malformed.id), hostile.reason);
    assert.ok(graph.criticalPaths.some((path) => path.positionId === malformed.id), hostile.reason);
    assert.equal(graph.status, 'ATTENTION_REQUIRED', hostile.reason);
  }
});

test('malformed and inconsistent exact capital amounts are explicit blockers', () => {
  const cases = [
    { sourceId: allocation.id, reason: 'ALLOCATION_REQUESTED_AMOUNT_INVALID',
      overrides: { allocationDecisions: [{ ...allocation, requestedAmount: '-1' }] } },
    { sourceId: allocation.id, reason: 'ALLOCATION_GRANTED_AMOUNT_INVALID',
      overrides: { allocationDecisions: [{ ...allocation, grantedAmount: '01' }] } },
    { sourceId: allocation.id, reason: 'ALLOCATION_GRANT_EXCEEDS_REQUEST',
      overrides: { allocationDecisions: [{ ...allocation, grantedAmount: '101' }] } },
    { sourceId: reservation.id, reason: 'RESERVATION_AMOUNT_INVALID',
      overrides: { reservations: [{ ...reservation, amount: '100.0' }] } },
    { sourceId: reservation.id, reason: 'RESERVATION_CONSUMED_AMOUNT_INVALID',
      overrides: { reservations: [{ ...reservation, consumedAmount: '-1' }] } },
    { sourceId: reservation.id, reason: 'RESERVATION_CONSUMED_AMOUNT_EXCEEDS_AMOUNT',
      overrides: { reservations: [{ ...reservation, consumedAmount: '101' }] } },
    { sourceId: plan.id, reason: 'STAGED_PLAN_REMAINING_AMOUNT_INVALID',
      overrides: { stagedPlans: [{ ...plan, remainingReservedAmount: '+0' }] } },
    { sourceId: mandate.id, reason: 'MANDATE_TARGET_EXPOSURE_INVALID',
      overrides: { mandates: [{ ...mandate, targetMaximumExposure: '100.0' }] } },
    { sourceId: approval.id, reason: 'APPROVAL_MAXIMUM_NOTIONAL_INVALID',
      overrides: { approvals: [{ ...approval, maximumNotional: 'not-a-decimal' }] } },
  ];
  for (const hostile of cases) {
    let graph;
    assert.doesNotThrow(() => { graph = projectActiveCapitalTopology(fixture(hostile.overrides)); }, hostile.reason);
    const node = graph.nodes.find((item) => item.sourceId === hostile.sourceId);
    assert.ok(node, hostile.reason);
    assert.ok(node.blockingReasons.includes(hostile.reason), hostile.reason);
    assert.ok(node.degradedReasons.includes(hostile.reason), hostile.reason);
    assert.notEqual(node.directBlockCategory, 'NONE', hostile.reason);
  }
});

test('invalid approval or mandate exact authority cannot create an authorization edge', () => {
  for (const overrides of [
    { approvals: [{ ...approval, maximumNotional: '-1' }] },
    { mandates: [{ ...mandate, targetMaximumExposure: '0100' }] },
  ]) {
    const graph = projectActiveCapitalTopology(fixture(overrides));
    const approvalNode = graph.nodes.find((node) => node.kind === 'APPROVAL' && node.sourceId === approval.id);
    const mandateNode = graph.nodes.find((node) => node.kind === 'MANDATE' && node.sourceId === mandate.id);
    assert.ok(approvalNode);
    assert.ok(mandateNode);
    assert.equal(graph.edges.some((edge) => edge.kind === 'AUTHORIZES'
      && edge.from === approvalNode.id && edge.to === mandateNode.id), false);
    assert.ok(graph.nodes.some((node) => node.kind === 'APPROVAL' && node.sourceId === `${mandate.id}:approval`));
  }
});

test('canonical zero exposure remains flat while canonical signed exposure remains visible', () => {
  const flat = { ...position, id: 'position-flat', state: 'ACTIVE', capitalLifecycle: 'ACTIVE',
    thesis: { ...position.thesis, id: 'thesis-flat' }, totalGrossExposure: '0', netDirectionalExposure: '0',
    oneLegExposure: '0', oneLegSinceMs: null, legs: [{ ...position.legs[0], id: 'leg-flat', quantity: '0',
      quoteExposure: '0', externalLifecycle: 'FILLED' }], executionReference: null, reconciliationReference: null,
    outstandingActionIntentIds: [], truth: truth() };
  const directional = { ...flat, id: 'position-directional', thesis: { ...flat.thesis, id: 'thesis-directional' },
    legs: [{ ...flat.legs[0], id: 'leg-directional' }], netDirectionalExposure: '-1' };
  const graph = projectActiveCapitalTopology(fixture({ positions: [flat, directional], reconciliationReferences: [],
    supervisionDecisions: [], intents: [], economics: [], checkpoint: null }));
  assert.equal(graph.exposedPositionIds.includes(flat.id), false);
  assert.equal(graph.criticalPaths.some((path) => path.positionId === flat.id), false);
  assert.ok(graph.exposedPositionIds.includes(directional.id));
  assert.ok(graph.criticalPaths.some((path) => path.positionId === directional.id));
});

test('closed labels cannot hide positive exposure from topology or attention', () => {
  const closed = { ...position, state: 'CLOSED', capitalLifecycle: 'CLOSED', oneLegExposure: '0',
    legs: [{ ...position.legs[0], externalLifecycle: 'FILLED' }] };
  const graph = projectActiveCapitalTopology(fixture({ positions: [closed] }));
  const positionNode = graph.nodes.find((node) => node.sourceId === closed.id);
  assert.equal(positionNode.capitalExposed, true);
  assert.equal(positionNode.directBlockCategory, 'EXECUTION_UNCERTAINTY');
  assert.ok(positionNode.blockingReasons.includes('CLOSED_POSITION_HAS_EXPOSURE'));
  assert.ok(graph.attentionNodeIds.includes(positionNode.id));
  assert.deepEqual(graph.exposedPositionIds, [closed.id]);
  assert.equal(graph.criticalPaths[0].status, 'BLOCKED');
});

test('critical paths stay position-local when active positions share proposal lineage', () => {
  const healthy = { ...position, id: 'position-healthy', state: 'ACTIVE', capitalLifecycle: 'ACTIVE',
    mandateId: mandate.id, thesis: { ...position.thesis, id: 'thesis-healthy' }, oneLegExposure: '0',
    legs: [{ ...position.legs[0], id: 'leg-healthy', externalLifecycle: 'FILLED' }],
    reconciliationReference: recon, outstandingActionIntentIds: [] };
  const recovery = { ...position, id: 'position-recovery', mandateId: 'mandate-recovery',
    thesis: { ...position.thesis, id: 'thesis-recovery' }, legs: [{ ...position.legs[0], id: 'leg-recovery' }],
    outstandingActionIntentIds: [] };
  const recoveryMandate = { ...mandate, id: 'mandate-recovery', approvalId: null,
    allocationDecisionId: 'allocation-recovery', reservationId: 'reservation-recovery', stagedPlanId: 'plan-recovery' };
  const graph = projectActiveCapitalTopology(fixture({ positions: [healthy, recovery], mandates: [mandate, recoveryMandate] }));
  const healthyPath = graph.criticalPaths.find((path) => path.positionId === healthy.id);
  const recoveryNode = graph.nodes.find((node) => node.sourceId === recovery.id);
  assert.equal(healthyPath.nodeIds.includes(recoveryNode.id), false);
  assert.equal(healthyPath.rootCauseNodeIds.includes(recoveryNode.id), false);
});

test('missing dependencies are materialized as precise blocker nodes', () => {
  const missing = { ...position, state: 'ACTIVE', capitalLifecycle: 'ACTIVE', executionReference: null,
    reconciliationReference: null, thesis: { ...position.thesis, proposalId: 'proposal-missing', originalEvidenceIds: ['evidence-missing'] },
    mandateId: 'mandate-missing', outstandingActionIntentIds: ['intent-missing'] };
  const graph = projectActiveCapitalTopology(fixture({ proposals: [], evidence: [], mandates: [], positions: [missing],
    reconciliationReferences: [], supervisionDecisions: [], intents: [], economics: [], checkpoint: null }));
  for (const sourceId of ['proposal-missing', 'evidence-missing', 'mandate-missing', `${missing.id}:execution`,
    `${missing.id}:reconciliation`, 'intent-missing', `${missing.id}:supervision`, `${missing.id}:economics`, `${missing.id}:checkpoint`]) {
    const node = graph.nodes.find((item) => item.sourceId === sourceId);
    assert.ok(node, `missing materialized dependency ${sourceId}`);
    assert.equal(node.status, 'MISSING');
    assert.ok(node.blockingReasons.some((reason) => reason.startsWith('DEPENDENCY_NOT_SUPPLIED:')));
    assert.equal(node.operatorAttentionRequired, true);
  }
});

test('expired reservations, non-manual approvals, and expired risk verdicts block precisely', () => {
  const graph = projectActiveCapitalTopology(fixture({
    reservations: [{ ...reservation, expiresAtMs: NOW - 1 }],
    approvals: [{ ...approval, mode: 'ADVISORY' }],
    riskDecisions: [{ ...risk, verdict: { ...risk.verdict, expiresAt: NOW - 1 } }],
  }));
  const reservationNode = graph.nodes.find((node) => node.sourceId === reservation.id);
  const approvalNode = graph.nodes.find((node) => node.sourceId === approval.id);
  const riskNode = graph.nodes.find((node) => node.sourceId === risk.decisionId);
  assert.equal(reservationNode.directBlockCategory, 'CAPITAL_BLOCK');
  assert.ok(reservationNode.blockingReasons.includes('RESERVATION_EXPIRED'));
  assert.equal(approvalNode.directBlockCategory, 'APPROVAL_BLOCK');
  assert.ok(approvalNode.blockingReasons.includes('APPROVAL_NOT_MANUAL_ARMED'));
  assert.equal(riskNode.directBlockCategory, 'RISK_BLOCK');
  assert.ok(riskNode.blockingReasons.includes('RISK_DECISION_EXPIRED'));
});
