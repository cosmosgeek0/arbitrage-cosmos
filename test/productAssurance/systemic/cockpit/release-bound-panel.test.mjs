import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateReleaseBoundPanel,
} from '../../../../fixtures/productAssurance/systemic/cockpit/reference/release-bound-panel-evaluator.mjs';
import {
  observationFor,
} from './support/cockpit-fixture-builder.mjs';

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

const contractSet = json('../../../../fixtures/productAssurance/systemic/cockpit/fixtures/panel-contracts.v1.json');
const healthyRelease = json('../../../../fixtures/productAssurance/systemic/observability/cases/release-manifest-healthy.json');

function contract(contractId) {
  return contractSet.contracts.find((entry) => entry.contractId === contractId);
}

function evaluate(contractId, mutateRelease = () => {}, mutateObservation = () => {}) {
  const panelContract = contract(contractId);
  const releaseManifestInput = structuredClone(healthyRelease);
  mutateRelease(releaseManifestInput);
  const observation = observationFor(panelContract);
  observation.evidence.observedAtMs = releaseManifestInput.nowMs - 30;
  observation.evidence.lastIndependentProofAtMs = releaseManifestInput.nowMs - 150;
  mutateObservation(observation);
  const stateRuleSet = contractSet.stateRuleSets.find((entry) => (
    entry.ruleSetId === panelContract.stateRuleSetId
  ));
  return evaluateReleaseBoundPanel({
    contract: panelContract,
    observation,
    stateRuleSet,
    evaluatedAtMs: releaseManifestInput.nowMs,
    releaseManifestInput,
  });
}

test('healthy synthetic release proof passes the gate without claiming live green', () => {
  const output = evaluate('PANEL_DASHBOARD_TRUTH_V1');
  assert.equal(output.releaseManifestGate.result, 'PASS');
  assert.equal(output.releaseManifestGate.greenEligible, true);
  assert.equal(output.releaseManifestGate.liveGreenEligible, false);
  assert.equal(output.panel.displayState, 'SYNTHETIC');
  assert.deepEqual(output.releaseManifestGate.reasonCodes, ['PANEL_EXPECTED_MANIFEST_ITEM_NOT_LIVE']);
  assert.ok(Object.isFrozen(output));
});

test('an unrelated missing cockpit reporter stays scoped while whole-machine truth fails closed', () => {
  const omitNotifications = (release) => {
    release.observation.items = release.observation.items.filter((item) => (
      item.expectedId !== 'cockpit-projection:PANEL_NOTIFICATIONS_TRUTH_V1'
    ));
  };
  const basis = evaluate('PANEL_BASIS_TRUTH_V1', omitNotifications);
  const dashboard = evaluate('PANEL_DASHBOARD_TRUTH_V1', omitNotifications);
  assert.equal(basis.releaseManifestGate.result, 'PASS');
  assert.equal(dashboard.releaseManifestGate.result, 'FAIL');
  assert.ok(dashboard.releaseManifestGate.reasonCodes.includes('PANEL_WHOLE_MACHINE_MANIFEST_NOT_PASS'));
});

test('whole-machine truth consumes the complete release result, including sentinels', () => {
  const omitSentinel = (release) => {
    release.observation.items = release.observation.items.filter((item) => (
      item.expectedId !== 'independent-sentinel'
    ));
  };
  const basis = evaluate('PANEL_BASIS_TRUTH_V1', omitSentinel);
  const dashboard = evaluate('PANEL_DASHBOARD_TRUTH_V1', omitSentinel);
  assert.equal(basis.releaseManifestGate.result, 'PASS');
  assert.equal(dashboard.releaseManifestGate.result, 'FAIL');
  assert.ok(dashboard.releaseManifestGate.reasonCodes.includes('PANEL_WHOLE_MACHINE_MANIFEST_NOT_PASS'));
});

test('required dependency failure dereferences only into affected panel capabilities', () => {
  const staleBasisEdge = (release) => {
    release.observation.items.find((item) => (
      item.expectedId === 'dependency:public-usdm-source:basis-engine'
    )).freshnessState = 'STALE';
  };
  const basis = evaluate('PANEL_BASIS_TRUTH_V1', staleBasisEdge);
  const markets = evaluate('PANEL_MARKETS_TRUTH_V1', staleBasisEdge);
  assert.equal(basis.releaseManifestGate.result, 'FAIL');
  assert.deepEqual(basis.releaseManifestGate.dependencyBinding.rootCauseExpectedIds, [
    'dependency:public-usdm-source:basis-engine',
  ]);
  assert.ok(basis.releaseManifestGate.reasonCodes.includes('PANEL_DEPENDENT_COMPONENT_NOT_PASS'));
  assert.equal(markets.releaseManifestGate.result, 'PASS');
});

test('Dashboard source proof is exactly four named aggregations covering seven semantic streams once', () => {
  const output = evaluate('PANEL_DASHBOARD_TRUTH_V1');
  assert.equal(output.releaseManifestGate.sourceBinding.required, true);
  assert.equal(output.releaseManifestGate.sourceBinding.exact, true);
  assert.equal(output.releaseManifestGate.sourceBinding.rowIds.length, 4);
  assert.equal(output.releaseManifestGate.sourceBinding.coveredStreamIds.length, 7);
  assert.deepEqual(output.releaseManifestGate.sourceBinding.duplicateStreamIds, []);

  assert.throws(() => evaluate(
    'PANEL_DASHBOARD_TRUTH_V1',
    () => {},
    (observation) => {
      observation.sourceRows[0].coveredExpectedManifestItemIds[0]
        = observation.sourceRows[1].coveredExpectedManifestItemIds[0];
    },
  ), (error) => error?.code === 'SOURCE_ROW_IDENTITY_MISMATCH');
});

test('six visible recovery controls bind distinct backends within the eight-path command denominator', () => {
  const controls = contractSet.contracts.filter((entry) => entry.panelKind === 'CONTROL');
  const outputs = controls.map((entry) => evaluate(entry.contractId));
  const expectedVisibleCommands = [
    'command-path:APPLY_CONFIGURATION',
    'command-path:REVOKE_APPROVAL',
    'command-path:SET_COMPONENT_STATE',
    'command-path:SET_INTAKE_PAUSED',
    'command-path:SET_KILL_SWITCH',
    'command-path:SET_SAFE_MODE',
  ];
  assert.equal(controls.length, 6);
  assert.deepEqual(outputs.map((output) => (
    output.releaseManifestGate.controlBinding.expectedManifestItemId
  )).sort(), expectedVisibleCommands);
  assert.deepEqual(healthyRelease.manifest.expectedItems
    .filter((item) => item.kind === 'COMMAND_PATH')
    .map((item) => item.expectedId)
    .filter((id) => !expectedVisibleCommands.includes(id))
    .sort(), [
      'command-path:RESTART_COMPONENT',
      'command-path:REVOKE_RESERVATION',
    ]);
  for (const output of outputs) {
    assert.equal(output.releaseManifestGate.result, 'PASS');
    assert.equal(output.releaseManifestGate.controlBinding.required, true);
    assert.equal(output.releaseManifestGate.controlBinding.result, 'PASS');
    assert.equal(output.releaseManifestGate.denominatorBinding.expectedRequiredEnabledCount, 8);
  }
});

test('a failed command reporter blocks only its bound visible control', () => {
  const staleKillSwitch = (release) => {
    release.observation.items.find((item) => (
      item.expectedId === 'command-path:SET_KILL_SWITCH'
    )).freshnessState = 'STALE';
  };
  const killSwitch = evaluate('CONTROL_KILL_SWITCH_V1', staleKillSwitch);
  const safeMode = evaluate('CONTROL_SAFE_MODE_V1', staleKillSwitch);
  assert.equal(killSwitch.releaseManifestGate.result, 'FAIL');
  assert.ok(killSwitch.releaseManifestGate.reasonCodes.includes('PANEL_CONTROL_COMMAND_ITEM_NOT_PASS'));
  assert.equal(safeMode.releaseManifestGate.result, 'PASS');
});
