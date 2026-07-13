import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE_PROTOCOL_COMMIT,
  EDGE_PROTOCOL_SCHEMA_SHA256,
  evaluateQProtocolHandshake,
  projectCapitalRiskReference,
  projectExecutionReference,
  projectQAssessmentReference,
  projectStrategyDecisionReference,
} from '../../../dist/productIntegration/adapters/index.js';
import { PRODUCT_FIXTURE_NOW_MS, Q_ABSTAIN_ASSESSMENT_FIXTURE, Q_ABSTAIN_VALIDATION_RECEIPT } from '../../../dist/productIntegration/fixtures/index.js';
import { canonicalProductJson } from '../../../dist/productIntegration/contracts/index.js';

test('Q handshake pins exact immutable protocol commit, version, schema hash, and champion', () => {
  assert.deepEqual(evaluateQProtocolHandshake({ protocolCommit: EDGE_PROTOCOL_COMMIT, protocolVersion: 1, schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256, producerBuild: 'q-build-1', championModelVersion: 'model-1' }), { compatible: true, reasonCode: null });
  assert.equal(evaluateQProtocolHandshake({ protocolCommit: EDGE_PROTOCOL_COMMIT, protocolVersion: 1, schemaSha256: 'f'.repeat(64), producerBuild: null, championModelVersion: 'model-1' }).reasonCode, 'PROTOCOL_SCHEMA_MISMATCH');
  assert.equal(evaluateQProtocolHandshake({ protocolCommit: EDGE_PROTOCOL_COMMIT, protocolVersion: 1, schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256, producerBuild: null, championModelVersion: null }).reasonCode, 'CHAMPION_UNAVAILABLE');
});

test('Q partial assessment remains abstaining and cannot become an opportunity verdict', () => {
  const projected = projectQAssessmentReference(Q_ABSTAIN_ASSESSMENT_FIXTURE, Q_ABSTAIN_VALIDATION_RECEIPT, PRODUCT_FIXTURE_NOW_MS - 50_000, 'SYNTHETIC_TEST');
  assert.equal(projected.disposition, 'ABSTAIN');
  assert.equal(projected.completeness, 'PARTIAL');
  assert.equal(projected.authority, 'SYNTHETIC_TEST');
  assert.ok(projected.reasonCodes.includes('BORROW_TRUTH_MISSING'));
  assert.equal('capitalVerdict' in projected, false);
  assert.equal('orderRequest' in projected, false);
});

test('expired or unavailable-authority Q assessment fails to abstention', () => {
  const input = { ...Q_ABSTAIN_ASSESSMENT_FIXTURE, advisoryAction: 'WATCH', abstentionReasonCodes: [], sourceQuality: { ...Q_ABSTAIN_ASSESSMENT_FIXTURE.sourceQuality, completeness: 'COMPLETE', gapCount: 0 } };
  const receipt = { ...Q_ABSTAIN_VALIDATION_RECEIPT, validatedProjectionJson: canonicalProductJson(input) };
  const projected = projectQAssessmentReference(input, receipt, PRODUCT_FIXTURE_NOW_MS, 'UNAVAILABLE');
  assert.equal(projected.disposition, 'ABSTAIN');
  assert.ok(projected.reasonCodes.includes('ASSESSMENT_EXPIRED'));
  assert.ok(projected.reasonCodes.includes('ACQUISITION_AUTHORITY_UNAVAILABLE'));
  assert.equal(projected.authority, 'UNAVAILABLE');
});

test('Q adapter requires an accepted full-schema validation receipt', () => {
  assert.throws(() => projectQAssessmentReference(Q_ABSTAIN_ASSESSMENT_FIXTURE, { ...Q_ABSTAIN_VALIDATION_RECEIPT, accepted: false }, PRODUCT_FIXTURE_NOW_MS, 'SYNTHETIC_TEST'), /schema-validation receipt/);
  assert.equal(evaluateQProtocolHandshake({ protocolCommit: EDGE_PROTOCOL_COMMIT, protocolVersion: 1, schemaSha256: EDGE_PROTOCOL_SCHEMA_SHA256, producerBuild: null, championModelVersion: '' }).reasonCode, 'CHAMPION_UNAVAILABLE');
  assert.throws(() => projectQAssessmentReference({ ...Q_ABSTAIN_ASSESSMENT_FIXTURE, symbol: 'FORGEDUSDT' }, Q_ABSTAIN_VALIDATION_RECEIPT, PRODUCT_FIXTURE_NOW_MS, 'SYNTHETIC_TEST'), /not bound/);
});

test('expired economic assumptions force abstention even while assessment envelope is current', () => {
  const input = {
    ...Q_ABSTAIN_ASSESSMENT_FIXTURE,
    expiryTimeMs: PRODUCT_FIXTURE_NOW_MS + 10_000,
    economicAssumptionExpiresAtMs: PRODUCT_FIXTURE_NOW_MS - 1,
    configVersion: 'q-config-1',
    missingEconomicFields: [],
    advisoryAction: 'WATCH',
    abstentionReasonCodes: [],
    sourceQuality: { ...Q_ABSTAIN_ASSESSMENT_FIXTURE.sourceQuality, completeness: 'COMPLETE', gapCount: 0 },
  };
  const receipt = { ...Q_ABSTAIN_VALIDATION_RECEIPT, validatedProjectionJson: canonicalProductJson(input) };
  const projected = projectQAssessmentReference(input, receipt, PRODUCT_FIXTURE_NOW_MS, 'SYNTHETIC_TEST');
  assert.equal(projected.disposition, 'ABSTAIN');
  assert.ok(projected.reasonCodes.includes('ECONOMIC_ASSUMPTIONS_EXPIRED'));
});

test('strategy adapter preserves opaque owner verdict and reason codes', () => {
  const input = { strategy: 'BASIS', ownerId: 'basis-engine', decisionId: 'bd-1', proposalId: null, revision: null, correlationId: 'trace-1', occurredAtMs: PRODUCT_FIXTURE_NOW_MS, verdict: 'REJECTED', reasonCodes: ['BORROW_UNKNOWN'], authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', expiresAtMs: PRODUCT_FIXTURE_NOW_MS + 1_000 };
  assert.deepEqual(projectStrategyDecisionReference(input), input);
});

test('capital/risk adapter preserves unavailable verdicts without synthesizing approval', () => {
  const input = { opportunityId: 'opp-1', capitalVerdictId: null, riskVerdictId: null, capitalVerdict: 'UNAVAILABLE', riskVerdict: 'UNAVAILABLE', evaluatedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: ['ACCOUNT_TRUTH_UNAVAILABLE'], authority: 'UNAVAILABLE' };
  assert.deepEqual(projectCapitalRiskReference(input), input);
});

test('execution adapter preserves ambiguity, liabilities, and recovery references', () => {
  const input = { ticketId: 'ticket-1', executionState: 'RECOVERY_REQUIRED', reconciliationState: 'AMBIGUOUS', positionIds: ['position-1'], liabilityIds: ['liability-1'], recoveryCampaignIds: ['recovery-1'], blocksNewExposure: true, authority: 'SYNTHETIC_TEST', observedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: ['AMBIGUOUS_MUTATION'] };
  const projected = projectExecutionReference(input);
  assert.equal(projected.reconciliationState, 'AMBIGUOUS');
  assert.equal(projected.blocksNewExposure, true);
  assert.deepEqual(projected.liabilityIds, ['liability-1']);
});

test('capital/risk and execution contradictions fail closed', () => {
  assert.throws(() => projectCapitalRiskReference({ opportunityId: 'opp-1', capitalVerdictId: null, riskVerdictId: null, capitalVerdict: 'PERMIT', riskVerdict: 'APPROVE', evaluatedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: [], authority: 'UNAVAILABLE' }), /owner ID|unavailable authority/);
  assert.throws(() => projectExecutionReference({ ticketId: 'ticket-1', executionState: 'UNKNOWN', reconciliationState: 'AMBIGUOUS', positionIds: [], liabilityIds: [], recoveryCampaignIds: [], blocksNewExposure: false, authority: 'SYNTHETIC_TEST', observedAtMs: PRODUCT_FIXTURE_NOW_MS, reasonCodes: [] }), /must block/);
});
