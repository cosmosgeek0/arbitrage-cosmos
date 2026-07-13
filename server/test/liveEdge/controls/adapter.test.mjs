import assert from 'node:assert/strict';
import test from 'node:test';

import { DurableControlCommandAdapter } from '../../../dist/liveEdge/controls/index.js';
import { actions, createHarness, previewRequest } from './fixtures.mjs';

async function previewAndSubmit(adapter, request) {
  const preview = await adapter.preview(request);
  assert.equal(preview.ok, true, preview.ok ? '' : preview.failure.code);
  const result = await adapter.submit({
    schema: 'LIVE_EDGE_DURABLE_CONTROL_V1',
    version: 1,
    preview: preview.value,
  });
  return { preview: preview.value, result };
}

test('component desired state is persisted before the accepted Foundation Control Plane issue', async () => {
  let sawIntent = false;
  const harness = createHarness({
    onFoundation({ request }) {
      sawIntent = harness.journals.get(harness.previewCommandId)?.events[0]?.event.kind === 'CONTROL_INTENT_COMMITTED';
      return {
        ok: true,
        value: {
          commandId: 'cmd_aaaaaaaaaaaaaaaa',
          correlationId: 'cor_aaaaaaaaaaaaaaaa',
          command: request.command,
          revision: request.revision,
          applied: true,
          detail: 'accepted',
        },
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const preview = await adapter.preview(previewRequest(actions.desired));
  assert.equal(preview.ok, true);
  harness.previewCommandId = preview.value.commandId;
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: preview.value });
  assert.equal(result.ok, true);
  assert.equal(sawIntent, true);
  assert.equal(harness.calls.foundation, 1);
  assert.equal(harness.calls.publish, 0);
  assert.equal(result.value.disposition, 'APPLIED');
  assert.deepEqual(result.value.ledgerEventIds, [101, 102]);
  assert.equal(result.value.externalActionAuthorization, 'NONE');
});

test('non-lifecycle controls publish only after the canonical intent acknowledgement', async () => {
  let publishedAfterIntent = false;
  const harness = createHarness({
    onPublish({ context }) {
      publishedAfterIntent = harness.journals.get(context.commandId)?.events[0]?.event.kind === 'CONTROL_INTENT_COMMITTED';
      return { accepted: true, applied: true, reasonCode: 'CONTROL_APPLIED' };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const { result } = await previewAndSubmit(adapter, previewRequest(actions.pause));
  assert.equal(result.ok, true);
  assert.equal(publishedAfterIntent, true);
  assert.equal(harness.calls.publish, 1);
  assert.equal(harness.calls.foundation, 0);
  assert.equal(harness.calls.append, 2);
});

test('exact completed replay returns the original receipt without repeating owner activity', async () => {
  const harness = createHarness();
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const first = await previewAndSubmit(adapter, previewRequest(actions.halt));
  assert.equal(first.result.ok, true);
  const ownerCalls = harness.calls.publish;
  const appendCalls = harness.calls.append;
  harness.clock.value = first.preview.expiresAtMs + 60_000;
  const replay = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.preview });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.value, first.result.value);
  assert.equal(harness.calls.publish, ownerCalls);
  assert.equal(harness.calls.append, appendCalls);
});

test('exact terminal rejection replays its original reason without repeating owner activity', async () => {
  const harness = createHarness({
    onPublish({ context, clock, snapshot }) {
      return {
        accepted: false,
        applied: false,
        reasonCode: 'OWNER_REJECTED',
        evaluatedAtMs: clock.value,
        deadlineAtMs: context.expiresAtMs,
        deadlineHonored: true,
        observedConfigVersion: snapshot.configVersion,
        observedControlRevision: snapshot.controlRevision,
      };
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const first = await previewAndSubmit(adapter, previewRequest(actions.halt));
  assert.equal(first.result.ok, false);
  assert.equal(first.result.failure.code, 'OWNER_REJECTED');
  assert.equal(harness.journals.get(first.preview.commandId)?.rejection?.reasonCode, 'OWNER_REJECTED');
  const ownerCalls = harness.calls.publish;
  const appendCalls = harness.calls.append;
  harness.clock.value = first.preview.expiresAtMs + 60_000;
  const replay = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.preview });
  assert.equal(replay.ok, false);
  assert.equal(replay.failure.code, 'OWNER_REJECTED');
  assert.equal(harness.calls.publish, ownerCalls);
  assert.equal(harness.calls.append, appendCalls);
});

test('receipt and replay bind the command-reserved revision, not a later ambient revision', async () => {
  const harness = createHarness({
    onAppend({ request, snapshot }) {
      if (request.event.kind === 'CONTROL_APPLIED') snapshot.controlRevision = 9;
      return undefined;
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const first = await previewAndSubmit(adapter, previewRequest(actions.halt));
  assert.equal(first.result.ok, true);
  assert.equal(first.result.value.committedControlRevision, 8);
  assert.equal(harness.snapshot.controlRevision, 9);
  const replay = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.preview });
  assert.equal(replay.ok, true);
  assert.equal(replay.value.committedControlRevision, 8);
});

test('ACKNOWLEDGE_RECOVERY records awareness only and cannot clear recovery', async () => {
  const harness = createHarness({ recoveryState: 'RECOVERY_REQUIRED' });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const { result } = await previewAndSubmit(adapter, previewRequest(actions.acknowledge));
  assert.equal(result.ok, true);
  assert.equal(result.value.disposition, 'AWARENESS_RECORDED');
  assert.equal(result.value.applied, false);
  assert.equal(result.value.recoveryStateChanged, false);
  assert.equal(harness.snapshot.recoveryState, 'RECOVERY_REQUIRED');
  assert.equal(harness.calls.publish, 0);
  assert.equal(harness.calls.foundation, 0);
  const journal = harness.journals.get(result.value.commandId);
  assert.equal(journal.events[1].event.kind, 'CONTROL_AWARENESS_RECORDED');
  assert.equal(journal.events[1].event.awarenessOnly, true);
});

test('unsupported owner and L08 dependencies return exact reasons without dispatch', async () => {
  const configHarness = createHarness({
    onInspect({ action }) {
      if (action.type === 'UPDATE_BOUNDED_CONFIGURATION') {
        return { accepted: false, reasonCode: 'CONFIGURATION_OWNER_NOT_WIRED', riskIncreasing: false };
      }
      return undefined;
    },
  });
  const configAdapter = new DurableControlCommandAdapter(configHarness.deps);
  const configPreview = await configAdapter.preview(previewRequest(actions.configuration));
  assert.equal(configPreview.ok, true);
  const config = await configAdapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: configPreview.value });
  assert.equal(config.ok, false);
  assert.equal(config.failure.code, 'CONFIGURATION_OWNER_NOT_WIRED');
  assert.equal(configHarness.calls.publish, 0);

  const waitingHarness = createHarness();
  const waitingAdapter = new DurableControlCommandAdapter(waitingHarness.deps);
  const recoveryPreview = await waitingAdapter.preview(previewRequest(actions.recovery));
  assert.equal(recoveryPreview.ok, true);
  const waiting = await waitingAdapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: recoveryPreview.value });
  assert.equal(waiting.ok, false);
  assert.equal(waiting.failure.code, 'WAITING_L08');
  assert.equal(waitingHarness.calls.inspect, 0);
  assert.equal(waitingHarness.calls.publish, 0);
  assert.equal(waitingHarness.calls.foundation, 0);
});

test('Foundation Control Plane rejections preserve mapped exact reasons across durable replay', async () => {
  const cases = [
    ['STALE_COMMAND_REVISION', 'STALE_CONTROL_REVISION'],
    ['COMMAND_REVISION_REUSED', 'IDEMPOTENCY_CONFLICT'],
    ['COMMAND_IN_PROGRESS', 'COMMAND_IN_PROGRESS'],
    ['COMMAND_NOT_APPLICABLE', 'COMMAND_NOT_APPLICABLE'],
  ];
  for (const [foundationCode, expectedCode] of cases) {
    const harness = createHarness({
      onFoundation({ request, clock }) {
        return {
          ok: false,
          failure: {
            component: 'foundation-control',
            stage: 'issue',
            code: foundationCode,
            message: `Synthetic ${foundationCode} rejection.`,
            occurredAt: clock.value,
            retryable: foundationCode === 'COMMAND_IN_PROGRESS',
            safeCurrentState: 'UNCHANGED',
            recommendedOperatorAction: 'Inspect canonical Foundation control state.',
            correlationId: `cor_${request.revision}_${foundationCode.toLowerCase()}`,
          },
        };
      },
    });
    const adapter = new DurableControlCommandAdapter(harness.deps);
    const control = await adapter.preview(previewRequest(actions.desired));
    assert.equal(control.ok, true);
    const submission = { schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control.value };
    const first = await adapter.submit(submission);
    assert.equal(first.ok, false);
    assert.equal(first.failure.code, expectedCode, foundationCode);
    assert.equal(harness.journals.get(control.value.commandId)?.rejection?.reasonCode, expectedCode);
    assert.equal(harness.calls.foundation, 1);
    const replay = await adapter.submit(submission);
    assert.equal(replay.ok, false);
    assert.equal(replay.failure.code, expectedCode, foundationCode);
    assert.equal(harness.calls.foundation, 1);
  }
});
