import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ValidateOnlyOrchestrator,
  projectDatabaseFailureBeforeSendCampaign,
} from '../../../dist/systemIntegration/verticalSlice/index.js';
import {
  buildValidateOnlyInput,
} from './fixtures.mjs';

test('[L-011] database failure before send is an exact zero-effect owner witness', async () => {
  const persisted = [];
  const persistence = {
    async loadValidateOnlyApprovalState() {
      throw new Error('synthetic database read failure before effect admission');
    },
    async persistValidateOnly(record) {
      persisted.push(record);
      return { persistenceId: 'ledger:l011:database-before-send' };
    },
  };
  const result = await new ValidateOnlyOrchestrator(persistence).execute(buildValidateOnlyInput());
  const witness = projectDatabaseFailureBeforeSendCampaign(result.snapshot);

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.failure.code, 'APPROVAL_STATE_READ_FAILED');
  assert.equal(persisted.length, 1, 'the fail-closed result remains ledgered when the receipt path is available');
  assert.deepEqual(witness, {
    schema: 'cosmos.system-integration.recovery-campaign.v1',
    scenario: 'DATABASE_FAILURE_BEFORE_SEND',
    rootCorrelationId: result.snapshot.rootCorrelationId,
    recordId: result.snapshot.recordId,
    disposition: 'BLOCKED_BEFORE_SEND',
    persistenceOutcome: 'DATABASE_READ_FAILED',
    failureCode: 'APPROVAL_STATE_READ_FAILED',
    approvalEvaluations: 0,
    riskEvaluations: 0,
    coordinatorsCreated: 0,
    coordinatorPreflights: 0,
    venueCalls: 0,
    submissionCalls: 0,
    executionAuthority: 'NONE',
    sendCapability: 'ABSENT',
  });
  assert.equal(Object.isFrozen(witness), true);
});
