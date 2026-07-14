import assert from 'node:assert/strict';
import test from 'node:test';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';

const T0 = 1_800_000_000_000;
const ACTOR = Object.freeze({ id: 'local-operator', email: null, source: 'loopback' });

function initial(overrides = {}) {
  return Object.freeze({
    revision: 0,
    generation: 1,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: T0,
    correlationId: 'cor_initial_control',
    ...overrides,
  });
}

function request(idempotencyKey, expectedRevision, mutation, overrides = {}) {
  return Object.freeze({
    idempotencyKey,
    expectedRevision,
    reason: 'Deterministic operator control test',
    requestedAtMs: T0 + 100 + expectedRevision,
    correlationId: `cor_${idempotencyKey.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 128),
    mutation: Object.freeze(mutation),
    ...overrides,
  });
}

class FakePersistence {
  constructor(state) {
    this.state = state;
    this.records = new Map();
    this.rejectionRecords = new Map();
    this.rejections = [];
    this.commits = [];
    this.nextEventId = 1;
    this.failLookup = false;
    this.failCommit = false;
    this.failMark = false;
  }

  async findControlMutation(key) {
    if (this.failLookup) throw new Error('fixture secret must never escape');
    return this.records.get(key) ?? null;
  }

  async recordControlRejection(audit) {
    const prior = this.rejectionRecords.get(audit.dedupeKey);
    if (prior !== undefined) return { kind: 'IDEMPOTENT_REPLAY', ledgerEventId: prior };
    const ledgerEventId = this.nextEventId++;
    this.rejectionRecords.set(audit.dedupeKey, ledgerEventId);
    this.rejections.push(audit);
    return { kind: 'RECORDED', ledgerEventId };
  }

  async commitControlMutation(commit) {
    if (this.failCommit) throw new Error('fixture secret must never escape');
    const existing = this.records.get(commit.request.idempotencyKey);
    if (existing) {
      return existing.requestDigest === commit.requestDigest
        ? { kind: 'IDEMPOTENT_REPLAY', ...existing }
        : { kind: 'IDEMPOTENCY_CONFLICT', requestDigest: existing.requestDigest };
    }
    if (commit.request.expectedRevision !== this.state.revision || commit.before.revision !== this.state.revision) {
      return { kind: 'REVISION_CONFLICT', current: this.state };
    }
    const receipt = Object.freeze({
      applied: commit.applied,
      code: commit.code,
      before: commit.before,
      after: commit.after,
      ledgerEventId: this.nextEventId++,
    });
    this.state = receipt.after;
    this.commits.push(commit);
    const runtimePublication = commit.applied && ['RESTART_COMPONENT', 'SET_COMPONENT_STATE'].includes(commit.request.mutation.command)
      ? 'PENDING'
      : 'NOT_REQUIRED';
    this.records.set(commit.request.idempotencyKey, {
      requestDigest: commit.requestDigest,
      receipt,
      runtimePublication,
    });
    return { kind: 'COMMITTED', receipt, runtimePublication };
  }

  async markControlRuntimePublished(commit) {
    if (this.failMark) throw new Error('deterministic publication marker failure');
    const existing = this.records.get(commit.idempotencyKey);
    if (!existing || existing.requestDigest !== commit.requestDigest) {
      throw new Error('deterministic publication marker mismatch');
    }
    if (existing.runtimePublication === 'PUBLISHED') return { kind: 'IDEMPOTENT_REPLAY' };
    existing.runtimePublication = 'PUBLISHED';
    return { kind: 'PUBLISHED' };
  }
}

class FakeComposition {
  constructor() {
    this.inspections = [];
    this.published = [];
    this.publishCalls = 0;
    this.failInspection = false;
    this.failPublication = false;
    this.publicationEvidence = new Map();
    this.desired = new Map([
      ['basis-engine', 'RUNNING'],
      ['engine-supervisor', 'RUNNING'],
      ['execution-coordinator-validate-only', 'STOPPED'],
    ]);
  }

  async inspectMutation(mutation) {
    if (this.failInspection) throw new Error('apiSecret=fixture-super-secret-value');
    this.inspections.push(mutation);
    if (mutation.command === 'APPLY_CONFIGURATION') {
      return mutation.configurationRevision === 'cfg-1' && /^(?:sha256:)?a{64}$/.test(mutation.payloadDigest)
        ? { ok: true, applied: true, riskIncreasing: false, code: 'CONFIGURATION_APPLIED', message: '' }
        : { ok: false, applied: false, riskIncreasing: false, code: 'CONFIGURATION_NOT_FOUND', message: 'Configuration revision is unavailable.' };
    }
    if (mutation.command === 'REVOKE_APPROVAL' && mutation.approvalId !== 'approval-1') {
      return { ok: false, applied: false, riskIncreasing: false, code: 'APPROVAL_NOT_FOUND', message: 'Approval is unavailable.' };
    }
    if (mutation.command === 'REVOKE_RESERVATION' && mutation.reservationId !== 'reservation-1') {
      return { ok: false, applied: false, riskIncreasing: false, code: 'RESERVATION_NOT_FOUND', message: 'Reservation is unavailable.' };
    }
    if (mutation.command === 'RESTART_COMPONENT' && mutation.componentId !== 'basis-engine') {
      return { ok: false, applied: false, riskIncreasing: false, code: 'CONTROL_NOT_SUPPORTED', message: 'Component cannot be restarted.' };
    }
    if (mutation.command === 'SET_COMPONENT_STATE') {
      const current = this.desired.get(mutation.componentId);
      return {
        ok: current !== undefined,
        applied: current !== mutation.desiredState,
        riskIncreasing: mutation.componentId === 'execution-coordinator-validate-only' && mutation.desiredState === 'RUNNING',
        code: current === undefined ? 'COMPONENT_NOT_FOUND' : 'COMPONENT_STATE_ACCEPTED',
        message: current === undefined ? 'Component is unavailable.' : '',
      };
    }
    return { ok: true, applied: true, riskIncreasing: false, code: 'CONTROL_APPLIED', message: '' };
  }

  async publishCommitted(controlRequest, _actor, receipt) {
    this.publishCalls += 1;
    const effectId = `${controlRequest.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`;
    if (this.failPublication) {
      this.publicationEvidence.set(effectId, 'NOT_APPLIED');
      throw new Error('deterministic runtime publication failure');
    }
    this.published.push({ controlRequest, receipt });
    if (['RESTART_COMPONENT', 'SET_COMPONENT_STATE'].includes(controlRequest.mutation.command)) {
      this.publicationEvidence.set(effectId, 'APPLIED');
    }
    if (receipt.applied && controlRequest.mutation.command === 'SET_COMPONENT_STATE') {
      this.desired.set(controlRequest.mutation.componentId, controlRequest.mutation.desiredState);
    }
  }

  inspectCommittedPublication(controlRequest, receipt) {
    return this.publicationEvidence.get(
      `${controlRequest.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`,
    ) ?? 'UNKNOWN';
  }
}

function world(state = initial()) {
  const persistence = new FakePersistence(state);
  const composition = new FakeComposition();
  const service = new SystemControlService({ initialState: state, persistence, composition });
  return { service, persistence, composition };
}

test('durable idempotency replays the original receipt and rejects conflicts and stale revisions', async () => {
  const { service, persistence, composition } = world();
  const firstRequest = request('mode.change.0001', 0, { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' });
  const first = await service.mutate(firstRequest, ACTOR);
  assert.equal(first.ok, true);
  assert.equal(first.value.applied, true);
  assert.equal(first.value.after.revision, 1);
  assert.equal(first.value.after.safeMode, 'ADVISORY');
  assert.equal(first.value.ledgerEventId, 1);

  const replay = await service.mutate({
    ...firstRequest,
    requestedAtMs: T0 + 9_000,
    correlationId: 'cor_replayed_transport_request',
  }, ACTOR);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.value, first.value);
  assert.equal(persistence.commits.length, 1);
  assert.equal(composition.published.length, 1);

  const conflict = await service.mutate({ ...firstRequest, reason: 'Different intent under a reused key' }, ACTOR);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.failure.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const stale = await service.mutate(
    request('mode.change.0002', 0, { command: 'SET_SAFE_MODE', safeMode: 'VALIDATE_ONLY' }),
    ACTOR,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.failure.code, 'STALE_COMMAND_REVISION');
  assert.equal(service.snapshot().revision, 1);
});

test('persistence lookup or commit failure cannot mutate in-memory control state', async () => {
  const lookupWorld = world();
  lookupWorld.persistence.failLookup = true;
  const lookupBefore = lookupWorld.service.snapshot();
  const lookup = await lookupWorld.service.mutate(
    request('persist.fail.0001', 0, { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' }),
    ACTOR,
  );
  assert.equal(lookup.ok, false);
  assert.equal(lookup.failure.code, 'CONTROL_PERSISTENCE_UNAVAILABLE');
  assert.strictEqual(lookupWorld.service.snapshot(), lookupBefore);
  assert.doesNotMatch(lookup.failure.message, /fixture secret/i);

  const commitWorld = world();
  commitWorld.persistence.failCommit = true;
  const commitBefore = commitWorld.service.snapshot();
  const committed = await commitWorld.service.mutate(
    request('persist.fail.0002', 0, { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' }),
    ACTOR,
  );
  assert.equal(committed.ok, false);
  assert.equal(committed.failure.code, 'CONTROL_PERSISTENCE_UNAVAILABLE');
  assert.strictEqual(commitWorld.service.snapshot(), commitBefore);
  assert.equal(commitWorld.composition.published.length, 0);
});

test('committed restart publication failure stays pending and exact replay retries only proven-not-applied effect', async () => {
  const { service, persistence, composition } = world();
  const restart = request('restart.pending.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'basis-engine',
  });
  composition.failPublication = true;

  const first = await service.mutate(restart, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(first.failure.retryable, true);
  assert.equal(service.snapshot().revision, 1);
  assert.equal(service.snapshot().generation, 2);
  assert.equal(persistence.commits.length, 1);
  assert.equal(persistence.records.get(restart.idempotencyKey).runtimePublication, 'PENDING');
  assert.equal(composition.publishCalls, 1);

  composition.failPublication = false;
  const replay = await service.mutate(restart, ACTOR);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.after.generation, 2);
  assert.equal(persistence.commits.length, 1);
  assert.equal(persistence.records.get(restart.idempotencyKey).runtimePublication, 'PUBLISHED');
  assert.equal(composition.publishCalls, 2);

  const completedReplay = await service.mutate(restart, ACTOR);
  assert.equal(completedReplay.ok, true);
  assert.equal(composition.publishCalls, 2, 'published restart must not be reissued');
});

test('failed durable publication marker never causes a blind restart reissue', async () => {
  const { service, persistence, composition } = world();
  const restart = request('restart.mark.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'basis-engine',
  });
  persistence.failMark = true;

  const first = await service.mutate(restart, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(composition.publishCalls, 1);
  assert.equal(persistence.records.get(restart.idempotencyKey).runtimePublication, 'PENDING');

  persistence.failMark = false;
  const replay = await service.mutate(restart, ACTOR);
  assert.equal(replay.ok, true);
  assert.equal(composition.publishCalls, 1, 'APPLIED readback must mark without reissuing');
  assert.equal(persistence.records.get(restart.idempotencyKey).runtimePublication, 'PUBLISHED');
});

test('application-process restart keeps unknown committed effect pending until canonical absence is proven', async () => {
  const firstWorld = world();
  const restart = request('restart.process.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'basis-engine',
  });
  firstWorld.composition.failPublication = true;
  const first = await firstWorld.service.mutate(restart, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');

  const afterRestartComposition = new FakeComposition();
  const afterRestartService = new SystemControlService({
    initialState: firstWorld.persistence.state,
    persistence: firstWorld.persistence,
    composition: afterRestartComposition,
  });
  const unknownReplay = await afterRestartService.mutate(restart, ACTOR);
  assert.equal(unknownReplay.ok, false);
  assert.equal(unknownReplay.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(afterRestartComposition.publishCalls, 0);

  const effectId = `${restart.idempotencyKey}:${firstWorld.persistence.state.revision}:${firstWorld.persistence.state.generation}`;
  afterRestartComposition.publicationEvidence.set(effectId, 'NOT_APPLIED');
  const provenAbsentReplay = await afterRestartService.mutate(restart, ACTOR);
  assert.equal(provenAbsentReplay.ok, true);
  assert.equal(afterRestartComposition.publishCalls, 1);
  assert.equal(firstWorld.persistence.records.get(restart.idempotencyKey).runtimePublication, 'PUBLISHED');
});

test('committed component-state command failure retries only after NOT_APPLIED readback', async () => {
  const { service, persistence, composition } = world();
  const pause = request('state.pending.0001', 0, {
    command: 'SET_COMPONENT_STATE', componentId: 'basis-engine', desiredState: 'PAUSED',
  });
  composition.failPublication = true;

  const first = await service.mutate(pause, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(persistence.records.get(pause.idempotencyKey).runtimePublication, 'PENDING');
  assert.equal(composition.desired.get('basis-engine'), 'RUNNING');

  composition.failPublication = false;
  const replay = await service.mutate(pause, ACTOR);
  assert.equal(replay.ok, true);
  assert.equal(composition.desired.get('basis-engine'), 'PAUSED');
  assert.equal(composition.publishCalls, 2);
  assert.equal(persistence.records.get(pause.idempotencyKey).runtimePublication, 'PUBLISHED');
});

test('component-state marker failure and process restart remain pending without effect readback', async () => {
  const firstWorld = world();
  const pause = request('state.mark.crash.0001', 0, {
    command: 'SET_COMPONENT_STATE', componentId: 'basis-engine', desiredState: 'PAUSED',
  });
  firstWorld.persistence.failMark = true;
  const first = await firstWorld.service.mutate(pause, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(firstWorld.composition.desired.get('basis-engine'), 'PAUSED');

  firstWorld.persistence.failMark = false;
  const afterRestartComposition = new FakeComposition();
  const afterRestartService = new SystemControlService({
    initialState: firstWorld.persistence.state,
    persistence: firstWorld.persistence,
    composition: afterRestartComposition,
  });
  const unknownReplay = await afterRestartService.mutate(pause, ACTOR);
  assert.equal(unknownReplay.ok, false);
  assert.equal(unknownReplay.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(afterRestartComposition.publishCalls, 0);

  const effectId = `${pause.idempotencyKey}:${firstWorld.persistence.state.revision}:${firstWorld.persistence.state.generation}`;
  afterRestartComposition.publicationEvidence.set(effectId, 'NOT_APPLIED');
  const reconciled = await afterRestartService.mutate(pause, ACTOR);
  assert.equal(reconciled.ok, true);
  assert.equal(afterRestartComposition.publishCalls, 1);
  assert.equal(afterRestartComposition.desired.get('basis-engine'), 'PAUSED');
  assert.equal(firstWorld.persistence.records.get(pause.idempotencyKey).runtimePublication, 'PUBLISHED');
});

test('kill switch drains intake, blocks resume and risk increase, and release never resumes silently', async () => {
  const { service, composition } = world();
  composition.failInspection = true;
  const killed = await service.mutate(
    request('kill.engage.0001', 0, { command: 'SET_KILL_SWITCH', engaged: true }),
    ACTOR,
  );
  assert.equal(killed.ok, true);
  assert.equal(killed.value.after.killSwitchEngaged, true);
  assert.equal(killed.value.after.intakePaused, true);
  composition.failInspection = false;

  const resumeBlocked = await service.mutate(
    request('intake.resume.0001', 1, { command: 'SET_INTAKE_PAUSED', paused: false }),
    ACTOR,
  );
  assert.equal(resumeBlocked.ok, false);
  assert.equal(resumeBlocked.failure.code, 'KILL_SWITCH_ENGAGED');

  const riskBlocked = await service.mutate(
    request('component.risk.0001', 1, {
      command: 'SET_COMPONENT_STATE',
      componentId: 'execution-coordinator-validate-only',
      desiredState: 'RUNNING',
    }),
    ACTOR,
  );
  assert.equal(riskBlocked.ok, false);
  assert.equal(riskBlocked.failure.code, 'KILL_SWITCH_ENGAGED');

  const released = await service.mutate(
    request('kill.release.0001', 1, { command: 'SET_KILL_SWITCH', engaged: false }),
    ACTOR,
  );
  assert.equal(released.ok, true);
  assert.equal(released.value.after.killSwitchEngaged, false);
  assert.equal(released.value.after.intakePaused, true);
});

test('every live or autonomous mode variant returns the exact mechanical block before any port', async () => {
  for (const safeMode of ['LIVE', 'LIVE_MANUAL', 'MANUAL_ARMED', 'EXECUTION_LIVE', 'AUTONOMOUS', 'live_manual']) {
    const { service, persistence, composition } = world();
    const result = await service.mutate(
      request(`live.block.${safeMode}`.replace(/[^A-Za-z0-9._:-]/g, '_'), 0, { command: 'SET_SAFE_MODE', safeMode }),
      ACTOR,
    );
    assert.equal(result.ok, false, safeMode);
    assert.equal(result.failure.code, 'LIVE_EXECUTION_NOT_IMPLEMENTED', safeMode);
    assert.equal(service.snapshot().revision, 0, safeMode);
    assert.equal(persistence.commits.length, 0, safeMode);
    assert.equal(composition.inspections.length, 0, safeMode);
    assert.equal(persistence.rejections.length, 1, safeMode);
    assert.equal(persistence.rejections[0].code, 'LIVE_EXECUTION_NOT_IMPLEMENTED', safeMode);
    assert.equal(persistence.rejections[0].applied, false, safeMode);
    assert.equal(persistence.rejections[0].currentRevision, 0, safeMode);
    const replay = await service.mutate(
      request(`live.block.${safeMode}`.replace(/[^A-Za-z0-9._:-]/g, '_'), 0, { command: 'SET_SAFE_MODE', safeMode }),
      ACTOR,
    );
    assert.equal(replay.ok, false, safeMode);
    assert.equal(replay.failure.code, 'LIVE_EXECUTION_NOT_IMPLEMENTED', safeMode);
    assert.equal(persistence.rejections.length, 1, `${safeMode} rejection must be ledgered once`);
  }
});

test('configuration, revocation, restart, IDs, and fields remain strictly bounded', async () => {
  const configWorld = world();
  const config = await configWorld.service.mutate(request('config.apply.0001', 0, {
    command: 'APPLY_CONFIGURATION',
    configurationRevision: 'cfg-1',
    payloadDigest: 'a'.repeat(64),
  }), ACTOR);
  assert.equal(config.ok, true);

  const badDigestWorld = world();
  const badDigest = await badDigestWorld.service.mutate(request('config.bad.0001', 0, {
    command: 'APPLY_CONFIGURATION',
    configurationRevision: 'cfg-1',
    payloadDigest: 'not-a-digest',
  }), ACTOR);
  assert.equal(badDigest.ok, false);
  assert.equal(badDigest.failure.code, 'INVALID_CONTROL_REQUEST');

  const secretReasonWorld = world();
  const secretReason = await secretReasonWorld.service.mutate(request('reason.secret.0001', 0, {
    command: 'SET_SAFE_MODE', safeMode: 'ADVISORY',
  }, { reason: 'apiSecret=fixture-super-secret-value' }), ACTOR);
  assert.equal(secretReason.ok, false);
  assert.equal(secretReason.failure.code, 'INVALID_CONTROL_REQUEST');
  assert.doesNotMatch(secretReason.failure.message, /fixture-super-secret-value/);
  assert.equal(secretReasonWorld.persistence.commits.length, 0);

  for (const mutation of [
    { command: 'REVOKE_APPROVAL', approvalId: '../../approval' },
    { command: 'REVOKE_RESERVATION', reservationId: 'https://evil.example' },
    { command: 'RESTART_COMPONENT', componentId: 'https://evil.example' },
    { command: 'RESTART_COMPONENT', componentId: 'basis-engine', commandLine: 'rm -rf /' },
  ]) {
    const boundedWorld = world();
    const result = await boundedWorld.service.mutate(request('bounded.reject.0001', 0, mutation), ACTOR);
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'INVALID_CONTROL_REQUEST');
    assert.equal(boundedWorld.persistence.commits.length, 0);
  }

  const restartWorld = world();
  const restarted = await restartWorld.service.mutate(request('restart.basis.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'basis-engine',
  }), ACTOR);
  assert.equal(restarted.ok, true);
  assert.equal(restarted.value.after.generation, 2);

  const unsupportedWorld = world();
  const unsupported = await unsupportedWorld.service.mutate(request('restart.root.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'engine-supervisor',
  }), ACTOR);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.failure.code, 'CONTROL_NOT_SUPPORTED');
  assert.equal(unsupportedWorld.persistence.rejections.length, 1);
  assert.equal(unsupportedWorld.persistence.rejections[0].code, 'CONTROL_NOT_SUPPORTED');
  assert.equal(unsupportedWorld.persistence.rejections[0].currentRevision, 0);
  assert.equal(unsupportedWorld.service.snapshot().revision, 0);
  const unsupportedReplay = await unsupportedWorld.service.mutate(request('restart.root.0001', 0, {
    command: 'RESTART_COMPONENT', componentId: 'engine-supervisor',
  }), ACTOR);
  assert.equal(unsupportedReplay.ok, false);
  assert.equal(unsupportedReplay.failure.code, 'CONTROL_NOT_SUPPORTED');
  assert.equal(unsupportedWorld.persistence.rejections.length, 1, 'composition rejection must be ledgered once');
  assert.equal(unsupportedWorld.persistence.commits.length, 0);
  assert.equal(unsupportedWorld.service.snapshot().revision, 0);
});
