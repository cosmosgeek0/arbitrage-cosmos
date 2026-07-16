import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DurableControlCommandAdapter,
  operatorActorBinding,
} from '../../../dist/liveEdge/controls/index.js';
import { actions, createHarness, previewRequest } from './fixtures.mjs';

async function makePreview(harness, action = actions.pause) {
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const result = await adapter.preview(previewRequest(action));
  assert.equal(result.ok, true, result.ok ? '' : result.failure.code);
  return { adapter, preview: result.value };
}

test('forged client actor fields fail before identity, persistence, or owner ports', async () => {
  const harness = createHarness();
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const result = await adapter.preview({
    ...previewRequest(actions.pause),
    requestedBy: 'foreign-operator',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'STRICT_SCHEMA_VIOLATION');
  assert.equal(harness.calls.identity, 0);
  assert.equal(harness.calls.append, 0);
  assert.equal(harness.calls.inspect, 0);
});

test('preview actor A cannot be submitted through actor B identity', async () => {
  const identity = {
    authenticated: true,
    subjectId: 'operator.alpha',
    sessionId: 'session.alpha',
    source: 'CLOUDFLARE_ACCESS',
    audience: 'L14_DURABLE_CONTROLS',
    authenticatedAtMs: 1_719_999_999_000,
    expiresAtMs: 1_720_000_120_000,
  };
  const harness = createHarness({ identity });
  const { adapter, preview } = await makePreview(harness);
  identity.subjectId = 'operator.beta';
  identity.sessionId = 'session.beta';
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'OPERATOR_MISMATCH');
  assert.equal(harness.calls.lookup, 0);
  assert.equal(harness.calls.publish, 0);
  assert.equal(harness.calls.foundation, 0);
  assert.equal(harness.journals.has(preview.commandId), false);
  assert.equal(harness.rejectionAudits.length, 1);
  assert.equal(harness.rejectionAudits[0].event.actorBinding, operatorActorBinding(identity));
  assert.notEqual(harness.rejectionAudits[0].event.actorBinding, preview.actorBinding);
});

test('nested command mutation and digest mutation both fail closed', async () => {
  for (const mutate of [
    (preview) => { preview.action.scope = 'ALL'; },
    (preview) => { preview.previewDigest = `sha256:${'0'.repeat(64)}`; },
    (preview) => { preview.expectedConfigVersion += 1; },
    (preview) => { preview.expiresAtMs += 1; },
  ]) {
    const harness = createHarness();
    const { adapter, preview } = await makePreview(harness);
    const forged = structuredClone(preview);
    mutate(forged);
    const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: forged });
    assert.equal(result.ok, false);
    assert.ok(['INVALID_CONTROL_REQUEST', 'PREVIEW_DIGEST_MISMATCH'].includes(result.failure.code), result.failure.code);
    assert.equal(harness.calls.lookup, 0);
    assert.equal(harness.calls.publish, 0);
    assert.equal(harness.calls.foundation, 0);
  }
});

test('command expiry is rechecked after asynchronous inspection and before durable intent', async () => {
  const harness = createHarness({
    onInspect({ clock }) {
      clock.value += 10_000;
      return { accepted: true, reasonCode: 'CONTROL_APPLIED', riskIncreasing: false };
    },
  });
  const { adapter, preview } = await makePreview(harness);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMMAND_EXPIRED');
  assert.equal(harness.calls.publish, 0);
  assert.equal(harness.calls.foundation, 0);
  assert.equal(harness.journals.has(preview.commandId), false);
  assert.equal(harness.rejectionAudits[0]?.event.kind, 'CONTROL_REJECTED');
});

test('expiry during persistence returns no owner call', async () => {
  const harness = createHarness({
    onAppend({ request, clock }) {
      if (request.event.kind === 'CONTROL_INTENT_COMMITTED') clock.value = request.event.expiresAtMs;
      return undefined;
    },
  });
  const { adapter, preview } = await makePreview(harness);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMMAND_EXPIRED');
  assert.equal(harness.calls.publish, 0);
  assert.equal(harness.calls.foundation, 0);
});

test('expiry inside asynchronous owner publication remains durably pending and fail-closed', async () => {
  const harness = createHarness({
    onPublish({ context, clock }) {
      clock.value = context.expiresAtMs;
      return {
        accepted: true,
        applied: true,
        reasonCode: 'CONTROL_APPLIED',
        evaluatedAtMs: context.expiresAtMs - 1,
        deadlineAtMs: context.expiresAtMs,
        deadlineHonored: true,
      };
    },
  });
  const { adapter, preview } = await makePreview(harness);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMMAND_OUTCOME_UNCERTAIN');
  assert.equal(harness.calls.publish, 1);
  const journal = harness.journals.get(preview.commandId);
  assert.equal(journal.events.length, 1);
  assert.equal(journal.events[0].event.kind, 'CONTROL_INTENT_COMMITTED');
});

test('stale optimistic config version and command-ID conflicts fail without owner mutation', async () => {
  const staleHarness = createHarness();
  const stale = await makePreview(staleHarness);
  staleHarness.snapshot.configVersion += 1;
  const staleResult = await stale.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: stale.preview });
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.failure.code, 'STALE_CONFIG_VERSION');
  assert.equal(staleHarness.calls.publish, 0);

  const conflictHarness = createHarness();
  const first = await makePreview(conflictHarness);
  const firstResult = await first.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.preview });
  assert.equal(firstResult.ok, true);
  const forged = structuredClone(first.preview);
  forged.previewDigest = `sha256:${'1'.repeat(64)}`;
  const conflict = await first.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: forged });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failure.code, 'PREVIEW_DIGEST_MISMATCH');
  assert.equal(conflictHarness.calls.publish, 1);
});

test('two exact concurrent submissions invoke the owner once and replay safely', async () => {
  let inspections = 0;
  let release;
  const bothInspecting = new Promise((resolve) => { release = resolve; });
  const harness = createHarness({
    async onInspect() {
      inspections += 1;
      if (inspections === 2) release();
      await bothInspecting;
      return undefined;
    },
  });
  const { adapter, preview } = await makePreview(harness);
  const submission = { schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview };
  const results = await Promise.all([adapter.submit(submission), adapter.submit(submission)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.failure.code === 'COMMAND_IN_PROGRESS').length, 1);
  assert.equal(harness.calls.publish, 1);
  const replay = await adapter.submit(submission);
  assert.equal(replay.ok, true);
  assert.equal(harness.calls.publish, 1);
});

test('same server-minted command ID with a different valid preview is an idempotency conflict', async () => {
  const sharedId = 'cmd_1234567890abcdef1234567890abcdef';
  const harness = createHarness({ onMint: () => sharedId });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const first = await adapter.preview(previewRequest(actions.pause));
  const second = await adapter.preview(previewRequest(actions.halt));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.value.commandId, second.value.commandId);
  const applied = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.value });
  assert.equal(applied.ok, true);
  const conflict = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: second.value });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failure.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(harness.calls.publish, 1);
});

test('two command IDs cannot reserve the same optimistic global control revision', async () => {
  let inspections = 0;
  let release;
  const bothInspecting = new Promise((resolve) => { release = resolve; });
  const harness = createHarness({
    async onInspect() {
      inspections += 1;
      if (inspections === 2) release();
      await bothInspecting;
      return undefined;
    },
  });
  const adapter = new DurableControlCommandAdapter(harness.deps);
  const first = await adapter.preview(previewRequest(actions.pause));
  const second = await adapter.preview(previewRequest(actions.halt));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const results = await Promise.all([
    adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: first.value }),
    adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: second.value }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.failure.code === 'STALE_CONTROL_REVISION').length, 1);
  assert.equal(harness.calls.publish, 1);
});

test('malformed or foreign completed receipts never cross the replay boundary', async () => {
  const harness = createHarness();
  const { adapter, preview } = await makePreview(harness);
  const first = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(first.ok, true);
  const journal = harness.journals.get(preview.commandId);
  journal.receipt = { ...journal.receipt, commandId: 'cmd_ffffffffffffffff' };
  const replay = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(replay.ok, false);
  assert.equal(replay.failure.code, 'PERSISTENCE_ACK_INVALID');
  assert.equal(harness.calls.publish, 1);
});

test('completed and rejected replays reject a foreign reserved control revision', async () => {
  const completedHarness = createHarness();
  const completed = await makePreview(completedHarness);
  const applied = await completed.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: completed.preview });
  assert.equal(applied.ok, true);
  const completedJournal = completedHarness.journals.get(completed.preview.commandId);
  completedJournal.receipt = { ...completedJournal.receipt, committedControlRevision: 999 };
  const completedReplay = await completed.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: completed.preview });
  assert.equal(completedReplay.ok, false);
  assert.equal(completedReplay.failure.code, 'PERSISTENCE_ACK_INVALID');
  assert.equal(completedHarness.calls.publish, 1);

  const rejectedHarness = createHarness({
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
  const rejected = await makePreview(rejectedHarness);
  const denied = await rejected.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: rejected.preview });
  assert.equal(denied.ok, false);
  assert.equal(denied.failure.code, 'OWNER_REJECTED');
  const rejectedJournal = rejectedHarness.journals.get(rejected.preview.commandId);
  rejectedJournal.rejection = { ...rejectedJournal.rejection, committedControlRevision: 999 };
  const rejectedReplay = await rejected.adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: rejected.preview });
  assert.equal(rejectedReplay.ok, false);
  assert.equal(rejectedReplay.failure.code, 'PERSISTENCE_ACK_INVALID');
  assert.equal(rejectedHarness.calls.publish, 1);
});

test('throwing and malformed Foundation owner ports remain pending outcome ambiguity', async () => {
  for (const onFoundation of [
    () => { throw new Error('synthetic owner failure'); },
    ({ request }) => ({
      ok: true,
      value: {
        commandId: 'cmd_aaaaaaaaaaaaaaaa',
        correlationId: 'cor_aaaaaaaaaaaaaaaa',
        command: request.command === 'START' ? 'STOP' : 'START',
        revision: request.revision,
        applied: true,
        detail: 'foreign command',
      },
    }),
  ]) {
    const harness = createHarness({ onFoundation });
    const adapter = new DurableControlCommandAdapter(harness.deps);
    const control = await adapter.preview(previewRequest(actions.desired));
    assert.equal(control.ok, true);
    const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control.value });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'COMMAND_OUTCOME_UNCERTAIN');
    assert.equal(harness.calls.foundation, 1);
    assert.equal(harness.journals.get(control.value.commandId).events.length, 1);
    assert.equal(harness.journals.get(control.value.commandId).events[0].event.kind, 'CONTROL_INTENT_COMMITTED');
  }
});

test('failure to durably finalize an owner rejection returns outcome uncertainty', async () => {
  const harness = createHarness({
    onInspect() {
      return { accepted: true, reasonCode: 'CONTROL_APPLIED', riskIncreasing: false };
    },
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
    onAppend({ request, makeAck }) {
      if (request.event.kind === 'CONTROL_REJECTED' && request.expectedJournalVersion === 1) {
        return makeAck(request, 'FAILED', { failureCode: 'PERSISTENCE_UNAVAILABLE' });
      }
      return undefined;
    },
  });
  const { adapter, preview } = await makePreview(harness);
  const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'COMMAND_OUTCOME_UNCERTAIN');
  assert.equal(harness.journals.get(preview.commandId).events.length, 1);
});

test('UNKNOWN recovery truth still permits halt, pause, reconciliation, and CLOSE truth validation', async () => {
  for (const action of [actions.halt, actions.pause, actions.reconcile, actions.close]) {
    const harness = createHarness({ recoveryState: 'UNKNOWN' });
    const adapter = new DurableControlCommandAdapter(harness.deps);
    const control = await adapter.preview(previewRequest(action));
    assert.equal(control.ok, true);
    const result = await adapter.submit({ schema: 'LIVE_EDGE_DURABLE_CONTROL_V1', version: 1, preview: control.value });
    if (action.type === 'CLOSE') {
      assert.equal(result.ok, false);
      assert.equal(result.failure.code, 'WAITING_L08');
      assert.equal(harness.calls.truth, 2);
    } else {
      assert.equal(result.ok, true, action.type);
    }
  }
});
