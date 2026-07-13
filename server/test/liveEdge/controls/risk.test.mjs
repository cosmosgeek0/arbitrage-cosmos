import assert from 'node:assert/strict';
import test from 'node:test';

import { DurableControlCommandAdapter } from '../../../dist/liveEdge/controls/index.js';
import { actions, createHarness, previewRequest } from './fixtures.mjs';

async function preview(adapter, action) {
  const result = await adapter.preview(previewRequest(action));
  assert.equal(result.ok, true, result.ok ? '' : result.failure.code);
  return result.value;
}

test('CANCEL and CLOSE re-read current exchange truth before dependency rejection', async () => {
  for (const action of [actions.cancel, actions.close]) {
    const harness = createHarness();
    const adapter = new DurableControlCommandAdapter(harness.deps);
    const control = await preview(adapter, action);
    assert.equal(harness.calls.truth, 1);
    const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'WAITING_L08');
    assert.equal(harness.calls.truth, 2, action.type);
    assert.equal(harness.calls.riskRecheck, 1, action.type);
    assert.equal(harness.calls.publish, 0);
    assert.equal(harness.calls.foundation, 0);
  }
});

test('a risk-owner claim that exceeds current or predeclared risk is rejected', async () => {
  const harness = createHarness({
    onRiskRecheck({ action, nowMs }) {
      return {
        allowed: true,
        reasonCode: 'CONTROL_APPLIED',
        projectedPostActionValue: '11',
        measureRevision: action.riskBound.measure.revision,
        evaluatedAtMs: nowMs,
        authority: 'FOUNDATION_RISK',
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const control = await preview(adapter, actions.cancel);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'RISK_INCREASE_FORBIDDEN');
  assert.equal(harness.calls.publish, 0);
  assert.equal(harness.calls.foundation, 0);
});

test('preview rejects risk evidence whose current value is not exchange truth', async () => {
  const harness = createHarness({
    onRiskPreview({ action, currentTruth, nowMs }) {
      return {
        truthRevision: currentTruth.truthRevision,
        measureRevision: action.riskBound.measure.revision,
        currentValue: '9',
        maximumPostActionValue: action.riskBound.maximumPostActionValue,
        evaluatedAtMs: nowMs,
        authority: 'FOUNDATION_RISK',
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const result = await adapter.preview(previewRequest(actions.close));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'RISK_OWNER_CONTRACT_INVALID');
  assert.equal(harness.calls.lookup, 0);
  assert.equal(harness.calls.append, 0);
});

test('stale, incomplete, and mismatched truth fail closed on final validation', async () => {
  for (const [status, code] of [
    ['STALE', 'EXCHANGE_TRUTH_STALE'],
    ['PARTIAL', 'EXCHANGE_TRUTH_INCOMPLETE'],
    ['DIVERGED', 'EXCHANGE_TRUTH_MISMATCH'],
    ['UNAVAILABLE', 'EXCHANGE_TRUTH_UNAVAILABLE'],
  ]) {
    let reads = 0;
    const harness = createHarness({
      onTruth({ truth }) {
        reads += 1;
        if (reads === 2) truth.status = status;
      },
    });
    const adapter = new DurableControlCommandAdapter(harness.deps);
    const control = await preview(adapter, actions.close);
    const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, code, status);
    assert.equal(harness.calls.publish, 0);
  }
});

test('risk definition substitution fails even when the numeric value looks smaller', async () => {
  let reads = 0;
  const harness = createHarness({
    onTruth({ truth }) {
      reads += 1;
      if (reads === 2) truth.riskMeasure.definition = {
        ...truth.riskMeasure.definition,
        id: 'different-risk-measure',
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const control = await preview(adapter, actions.cancel);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'RISK_INCREASE_FORBIDDEN');
  assert.equal(harness.calls.publish, 0);
});

test('canonical risk-owner denial preserves its exact rejection reason', async () => {
  const harness = createHarness({
    onRiskRecheck({ action, nowMs }) {
      return {
        allowed: false,
        reasonCode: 'EXCHANGE_TRUTH_MISMATCH',
        projectedPostActionValue: '5',
        measureRevision: action.riskBound.measure.revision,
        evaluatedAtMs: nowMs,
        authority: 'FOUNDATION_RISK',
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const control = await preview(adapter, actions.close);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'EXCHANGE_TRUTH_MISMATCH');
  assert.equal(harness.calls.publish, 0);
});

test('contradictory risk-owner decisions fail as owner-contract violations', async () => {
  const harness = createHarness({
    onRiskRecheck({ action, nowMs }) {
      return {
        allowed: false,
        reasonCode: 'CONTROL_APPLIED',
        projectedPostActionValue: '5',
        measureRevision: action.riskBound.measure.revision,
        evaluatedAtMs: nowMs,
        authority: 'FOUNDATION_RISK',
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const control = await preview(adapter, actions.cancel);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'RISK_OWNER_CONTRACT_INVALID');
});
