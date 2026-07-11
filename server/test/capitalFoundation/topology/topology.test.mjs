import test from 'node:test';
import assert from 'node:assert/strict';

import { projectActiveCapitalTopology } from '../../../dist/capitalFoundation/topology/index.js';
import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';
import { canonicalJson } from '../../../dist/foundation/contracts/index.js';

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
  stagedPlanDigest: plan.digest, proposalIntakeDigest: proposal.intakeDigest, configRevision: 'cfg-1', approvalId: 'approval-1',
  riskDecision: null, targetMaximumExposure: '100', valuationAsset: 'USDT', createdAtMs: NOW - 500, expiresAtMs: NOW + 5_000 };
const approval = { id: 'approval-1', proposalId: proposal.sourceProposalId, mandateId: mandate.id, stagedPlanId: plan.id,
  mode: 'MANUAL_ARMED', issuedAtMs: NOW - 450, expiresAtMs: NOW + 5_000, revokedAtMs: null };
const risk = { decisionId: 'risk-1', mandateId: mandate.id, externalPlanId: 'external-plan-1',
  verdict: { allowed: true, evaluatedAt: NOW - 400, expiresAt: NOW + 5_000, blockingCodes: [] } };
const recon = { id: 'recon-1', externalPlanId: 'external-plan-1', correlationId: 'execution-1', status: 'DIVERGED',
  observedAtMs: NOW - 100, sequence: 2, revision: 'recon-2', reasonCodes: ['CHECKPOINT_VENUE_MISMATCH'], truth: truth({ divergent: true }) };
const position = { id: 'position-1', revision: 1, mandateId: mandate.id,
  thesis: { id: 'thesis-1', revision: 1, proposalId: proposal.sourceProposalId, originalEvidenceIds: ['evidence-1'], openedAtMs: NOW - 300 },
  state: 'RECOVERY_REQUIRED', capitalLifecycle: 'RECOVERY_REQUIRED', legs: [{ id: 'leg-1', quoteExposure: '100', externalLifecycle: 'AMBIGUOUS', truth: truth() }],
  totalGrossExposure: '100', oneLegExposure: '100', reconciliationReference: recon, executionReference: null,
  lastTransitionAtMs: NOW - 50, truth: truth({ divergent: true }) };
const intent = { id: 'intent-1', positionId: position.id, kind: 'REQUEST_EMERGENCY_UNWIND', urgency: 'EMERGENCY',
  blockingFacts: ['ONE_LEG_EXPOSURE'], createdAtMs: NOW - 40 };
const economics = { id: 'economics-1', positionId: position.id, revision: 1, attribution: { accountingIdentityProven: false,
  completeness: 'DIVERGENT', divergentReasons: ['RESIDUAL_UNEXPLAINED'], missingComponentKinds: ['RESIDUAL_UNEXPLAINED'], evaluatedAtMs: NOW - 30 } };

function fixture(overrides = {}) {
  return { evaluatedAtMs: NOW, proposals: [proposal], evidence: [{ id: 'evidence-1', status: 'CURRENT', truth: truth(), lastTransitionAtMs: NOW - 1_000, reasonCodes: [] }],
    considerations: [consideration], allocationDecisions: [allocation], reservations: [reservation], mandates: [mandate], stagedPlans: [plan],
    approvals: [approval], riskDecisions: [risk], executionReferences: [], positions: [position], reconciliationReferences: [recon],
    supervisionDecisions: [{ id: 'supervision-1', positionId: position.id, status: 'RECOVERY', truth: truth(), lastTransitionAtMs: NOW - 20,
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
