import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OrdinaryShutdownAdmission,
  isRecoveryOnlyMutation,
} from '../../../dist/systemIntegration/application/shutdownAdmission.js';

test('ordinary drain refusal admits only bounded recovery controls and can be retried', () => {
  const admission = new OrdinaryShutdownAdmission();
  assert.equal(admission.phase(), 'OPEN');
  assert.equal(admission.admitsMutation('POST', '/api/config', {}), true);

  admission.beginDrainEvaluation();
  assert.equal(admission.phase(), 'DRAIN_EVALUATING');
  assert.equal(admission.admitsMutation('POST', '/api/system-integration/controls', {
    command: 'SET_KILL_SWITCH',
    engaged: true,
  }), false);

  admission.refuseDrain();
  assert.equal(admission.phase(), 'RECOVERY_ONLY');
  assert.equal(admission.admitsMutation('GET', '/api/system-integration/ops/readback', undefined), true);
  assert.equal(admission.admitsMutation('POST', '/api/system-integration/controls', {
    command: 'SET_KILL_SWITCH',
    engaged: true,
  }), true);
  assert.equal(admission.admitsMutation('POST', '/api/system-integration/controls', {
    command: 'SET_KILL_SWITCH',
    engaged: false,
  }), false);
  assert.equal(admission.admitsMutation('POST', '/api/system-integration/controls', {
    command: 'SET_INTAKE_PAUSED',
    paused: false,
  }), false);
  assert.equal(admission.admitsMutation('POST', '/api/config', { risk: 'changed' }), false);
  assert.equal(admission.admitsNewWebSocket(), false);

  admission.beginDrainEvaluation();
  admission.beginIrreversibleClose();
  assert.equal(admission.phase(), 'IRREVERSIBLE_CLOSING');
  assert.equal(admission.admitsMutation('POST', '/api/system-integration/controls', {
    command: 'SET_KILL_SWITCH',
    engaged: true,
  }), false);
});

test('recovery-only Product controls and direct restart stay exact and fail closed', () => {
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/product-integration/v1/commands/preview',
    { controlId: 'component.engine-supervisor.restart' },
  ), true);
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/product-integration/v1/commands',
    { controlId: 'global.safe-mode.read-only' },
  ), true);
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/product-integration/v1/commands',
    { controlId: 'unknown.control' },
  ), false);
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/system-integration/controls',
    { command: 'RESTART_COMPONENT', componentId: 'market-universe' },
  ), true);
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/system-integration/controls',
    { command: 'RESTART_COMPONENT', componentId: 'basis-strategy' },
  ), false);
  assert.equal(isRecoveryOnlyMutation(
    'POST',
    '/api/system-integration/controls',
    { command: 'APPLY_CONFIGURATION' },
  ), false);
});
