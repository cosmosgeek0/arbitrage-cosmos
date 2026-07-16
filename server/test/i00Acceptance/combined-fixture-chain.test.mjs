import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readJson, runAllScenarios, validateScenarioResult } from './harness.mjs';

const document = readJson('fixtures/i00/scenarios.json');
const results = runAllScenarios(document);

test('all 22 required deterministic fixture and failure campaigns run', () => {
  assert.equal(results.length, 22);
  assert.deepEqual(results.map((result) => result.id), Array.from({ length: 22 }, (_, index) => `I00-${String(index + 1).padStart(2, '0')}`));
  for (let index = 0; index < results.length; index += 1) validateScenarioResult(document.scenarios[index], results[index]);
});

test('normal Basis outcome spans the complete owner-preserving chain', () => {
  const requiredStages = [
    'PUBLIC_EVIDENCE', 'ATTENTION_Q', 'ENGINE_DECISION', 'OPPORTUNITY', 'CAPITAL', 'RISK',
    'TICKET_POLICY', 'EXCHANGE_TWIN', 'PRIVATE_RECONCILIATION', 'POSITION_RECOVERY',
    'OUTCOME', 'FEEDBACK', 'SUPERVISOR',
  ];
  const result = results.find((candidate) => candidate.id === 'I00-04');
  assert.deepEqual(result.trace.map((event) => event.stage), requiredStages);
  assert.equal(result.audit.submissionCalls, 0);
  assert.equal(result.audit.twinSimulationCalls, 1);
  assert.equal(result.audit.journalRecords, 1);
  assert.equal(result.audit.outputLinks, 12);
  for (let index = 1; index < result.trace.length; index += 1) {
    assert.equal(result.trace[index].inputId, result.trace[index - 1].outputId, `link ${index}`);
  }
});

test('Basis dry-run invalidation and Volume cap/stale-depth rejection stop before exchange', () => {
  const basis = results.find((candidate) => candidate.id === 'I00-03');
  assert.deepEqual(basis.trace.map((event) => event.stage), [
    'PUBLIC_EVIDENCE', 'ATTENTION_Q', 'ENGINE_DECISION', 'OPPORTUNITY', 'CAPITAL', 'RISK',
    'TICKET_POLICY', 'OPPORTUNITY', 'SUPERVISOR',
  ]);
  assert.equal(basis.trace.find((event) => event.stage === 'TICKET_POLICY').action, 'DRY_RUN_PLAN_READY');
  assert.equal(basis.audit.submissionCalls, 0);

  const volume = results.find((candidate) => candidate.id === 'I00-07');
  assert.deepEqual(volume.trace.map((event) => event.stage), [
    'PUBLIC_EVIDENCE', 'ATTENTION_Q', 'ENGINE_DECISION', 'OPPORTUNITY', 'CAPITAL', 'RISK', 'SUPERVISOR',
  ]);
  assert.equal(volume.trace.find((event) => event.stage === 'CAPITAL').action, 'CAPPED');
  assert.equal(volume.trace.find((event) => event.stage === 'RISK').reasonCode, 'STALE_DEPTH');
  assert.equal(volume.audit.submissionCalls, 0);
});

test('staleness kill partial-leg and liability failures preserve recovery visibility', () => {
  for (const id of ['I00-06', 'I00-10', 'I00-13', 'I00-14']) {
    const result = results.find((candidate) => candidate.id === id);
    assert.equal(result.audit.recoveryVisible, true, id);
    assert(result.trace.some((event) => event.stage === 'SUPERVISOR'), id);
  }
  const residual = results.find((candidate) => candidate.id === 'I00-06');
  assert(residual.audit.activeResidualLiability > 0);
  assert.equal(residual.audit.closureRefused, true);
  assert.equal(residual.audit.repayTruthProven, false);
  assert(!residual.trace.some((event) => event.stage === 'OUTCOME' || event.stage === 'FEEDBACK'));
  const partial = results.find((candidate) => candidate.id === 'I00-13');
  assert.equal(partial.audit.newEntriesHalted, true);
  assert(partial.trace.some((event) => event.action === 'NEW_ENTRIES_HALTED'));
});

test('mutation ambiguity and database campaigns are fail-closed and idempotent', () => {
  const before = results.find((result) => result.id === 'I00-16');
  const after = results.find((result) => result.id === 'I00-17');
  const ambiguous = results.find((result) => result.id === 'I00-12');
  const duplicate = results.find((result) => result.id === 'I00-18');
  assert.equal(before.audit.submissionCalls, 0);
  assert.equal(after.audit.submissionCalls, 1);
  assert.equal(after.audit.reconciledBeforeReady, true);
  assert.equal(ambiguous.audit.submissionCalls, 1);
  assert.equal(ambiguous.audit.journalRecords, 1);
  assert.equal(ambiguous.audit.duplicateMutations, 0);
  assert.equal(duplicate.audit.appliedMutations, 1);
  assert.equal(duplicate.audit.duplicateMutations, 0);
  assert.equal(results.find((result) => result.id === 'I00-19').audit.appliedMutations, 0);
});

test('incident flood deployment mismatch and restore drill remain bounded', () => {
  const flood = results.find((result) => result.id === 'I00-20');
  const deploy = results.find((result) => result.id === 'I00-21');
  const restore = results.find((result) => result.id === 'I00-22');
  assert.equal(flood.audit.incidentGroups, 1);
  assert.equal(flood.audit.materialEventCount, 100);
  assert.equal(deploy.terminal, 'PREFLIGHT_REJECTED_CURRENT_RELEASE_ACTIVE');
  assert.equal(deploy.audit.currentReleasePreserved, true);
  assert.equal(restore.audit.productionMutations, 0);
  assert.equal(restore.audit.isolatedRestoreVerified, true);
});
