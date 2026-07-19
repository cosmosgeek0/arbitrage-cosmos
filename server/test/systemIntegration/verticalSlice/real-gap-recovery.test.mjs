import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Ledger } from '../../../dist/ledger.js';
import {
  ValidateOnlyOrchestrator,
  projectDatabaseFailureBeforeSendCampaign,
} from '../../../dist/systemIntegration/verticalSlice/index.js';
import {
  SystemControlService,
  routeCanonicalAlarmToKillSwitch,
} from '../../../dist/systemIntegration/controls/index.js';
import {
  SystemLedgerPersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/index.js';
import {
  buildValidateOnlyInput,
} from './fixtures.mjs';

const NOW = 1_900_000_000_000;
function controlWorld({ failCommit = false } = {}) {
  let state = Object.freeze({
    revision: 0,
    generation: 1,
    safeMode: 'VALIDATE_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: NOW - 1,
    correlationId: 'control.before.alarm',
  });
  const records = new Map();
  const commits = [];
  const publications = [];
  const persistence = {
    async findControlMutation(idempotencyKey) {
      return records.get(idempotencyKey) ?? null;
    },
    async recordControlRejection() {
      return { kind: 'RECORDED', ledgerEventId: 999 };
    },
    async commitControlMutation(commit) {
      if (failCommit) throw new Error('synthetic durable control failure');
      if (commit.request.expectedRevision !== state.revision || commit.before.revision !== state.revision) {
        return { kind: 'REVISION_CONFLICT', current: state };
      }
      commits.push(commit);
      const receipt = Object.freeze({
        applied: commit.applied,
        code: commit.code,
        before: commit.before,
        after: commit.after,
        ledgerEventId: commits.length,
      });
      state = commit.after;
      records.set(commit.request.idempotencyKey, Object.freeze({
        requestDigest: commit.requestDigest,
        correlationId: commit.request.correlationId,
        recordedAtMs: commit.request.requestedAtMs,
        mutation: commit.request.mutation,
        receipt,
        runtimePublication: 'NOT_REQUIRED',
      }));
      return { kind: 'COMMITTED', receipt, runtimePublication: 'NOT_REQUIRED' };
    },
  };
  const composition = {
    async inspectMutation() {
      throw new Error('fail-safe kill must not depend on composition inspection');
    },
    async publishCommitted(request, actor, receipt) {
      publications.push({ request, actor, receipt });
    },
  };
  return {
    service: new SystemControlService({ initialState: state, persistence, composition }),
    commits,
    publications,
  };
}

function alarm(overrides = {}) {
  return {
    alarm: 'DISK_OR_DATABASE_FAILURE',
    state: 'ALARM',
    owner: 'FOUNDATION_OBSERVABILITY',
    ownerRevision: 'observability-alarm-revision-7',
    ownerDigest: 'a'.repeat(64),
    observedAtMs: NOW,
    automaticAction: 'NONE',
    canLiquidate: false,
    canMutateCapital: false,
    haltRecommendation: true,
    trace: {
      correlationId: 'cloud.alarm.database.0001',
      traceRevision: 'alarm-trace-revision-7',
    },
    reasonCodes: ['DATABASE_COMMIT_FAILURE'],
    ...overrides,
  };
}

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-alarm-halt-'));
}

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

test('[L-085] canonical cloud alarm engages the existing durable kill-switch owner once', async () => {
  const world = controlWorld();
  const first = await routeCanonicalAlarmToKillSwitch({
    service: world.service,
    alarm: alarm(),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 0,
  });

  assert.equal(first.ok, true);
  assert.equal(first.value.applied, true);
  assert.equal(first.value.after.killSwitchEngaged, true);
  assert.equal(first.value.after.intakePaused, true);
  assert.equal(first.value.after.revision, 1);
  assert.equal(world.commits.length, 1);
  assert.equal(world.publications.length, 1);
  assert.deepEqual(world.publications[0].request.mutation, { command: 'SET_KILL_SWITCH', engaged: true });
  assert.deepEqual(world.publications[0].actor, {
    id: 'system:canonical-alarm-router',
    email: null,
    source: 'canonical-alarm',
  });

  const replay = await routeCanonicalAlarmToKillSwitch({
    service: world.service,
    alarm: alarm(),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 0,
  });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.value, first.value);
  assert.equal(world.commits.length, 1, 'exact alarm replay must reuse the durable control receipt');
  assert.equal(world.publications.length, 1, 'exact alarm replay must not republish the kill effect');

  const alteredEvidence = await routeCanonicalAlarmToKillSwitch({
    service: world.service,
    alarm: alarm({ reasonCodes: ['DATABASE_COMMIT_FAILURE', 'NEW_OWNER_EVIDENCE'] }),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 0,
  });
  assert.equal(alteredEvidence.ok, false, 'changed alarm evidence must not alias the first durable receipt');
  assert.equal(alteredEvidence.failure.code, 'STALE_COMMAND_REVISION');

  const cleared = await routeCanonicalAlarmToKillSwitch({
    service: world.service,
    alarm: alarm({ state: 'OK', haltRecommendation: false }),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 1,
  });
  assert.equal(cleared.ok, false);
  assert.equal(cleared.failure.code, 'ALARM_EVIDENCE_INVALID');
  assert.equal(world.service.snapshot().killSwitchEngaged, true, 'alarm clear cannot release the durable kill switch');
  assert.equal(world.commits.length, 1);

  for (const hostile of [
    alarm({ observedAtMs: NOW - 1_001 }),
    alarm({ state: 'UNKNOWN', haltRecommendation: false }),
    alarm({ alarm: 'FORGED_ALARM_NAME' }),
    alarm({ ownerDigest: 'not-a-digest' }),
    alarm({ trace: null }),
  ]) {
    const deniedWorld = controlWorld();
    const denied = await routeCanonicalAlarmToKillSwitch({
      service: deniedWorld.service,
      alarm: hostile,
      evaluatedAtMs: NOW,
      maximumAgeMs: 1_000,
      expectedControlRevision: 0,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.failure.code, 'ALARM_EVIDENCE_INVALID');
    assert.equal(deniedWorld.commits.length, 0);
    assert.equal(deniedWorld.service.snapshot().killSwitchEngaged, false);
  }

  const failedWorld = controlWorld({ failCommit: true });
  const failed = await routeCanonicalAlarmToKillSwitch({
    service: failedWorld.service,
    alarm: alarm(),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 0,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failure.code, 'CONTROL_PERSISTENCE_UNAVAILABLE');
  assert.equal(failedWorld.service.snapshot().killSwitchEngaged, false);
  assert.equal(failedWorld.publications.length, 0);

  const forgedActorWorld = controlWorld();
  const forgedActor = await forgedActorWorld.service.mutate({
    idempotencyKey: 'alarm.forged.actor.0001',
    expectedRevision: 0,
    reason: 'Forged internal alarm actor must be rejected.',
    requestedAtMs: NOW,
    correlationId: 'alarm.forged.actor.0001',
    mutation: { command: 'SET_KILL_SWITCH', engaged: true },
  }, { id: 'operator-controlled-alarm', email: null, source: 'canonical-alarm' });
  assert.equal(forgedActor.ok, false);
  assert.equal(forgedActor.failure.code, 'OPERATOR_REQUIRED');
  assert.equal(forgedActorWorld.commits.length, 0);

  const releaseByAlarmActor = await world.service.mutate({
    idempotencyKey: 'alarm.release.forbidden.0001',
    expectedRevision: 1,
    reason: 'Canonical alarm identity must not release durable kill.',
    requestedAtMs: NOW,
    correlationId: 'alarm.release.forbidden.0001',
    mutation: { command: 'SET_KILL_SWITCH', engaged: false },
  }, { id: 'system:canonical-alarm-router', email: null, source: 'canonical-alarm' });
  assert.equal(releaseByAlarmActor.ok, false);
  assert.equal(releaseByAlarmActor.failure.code, 'OPERATOR_REQUIRED');
  assert.equal(world.service.snapshot().killSwitchEngaged, true);

  const clearFreezeByAlarmActor = await world.service.mutate({
    idempotencyKey: 'alarm.freeze.clear.forbidden.0001',
    expectedRevision: 1,
    reason: 'Canonical alarm identity must not clear the deployment freeze.',
    requestedAtMs: NOW,
    correlationId: 'alarm.freeze.clear.forbidden.0001',
    mutation: {
      command: 'CLEAR_DEPLOYMENT_FREEZE',
      expectedObservedAtUtc: new Date(NOW).toISOString().replace('.000Z', 'Z'),
    },
  }, { id: 'system:canonical-alarm-router', email: null, source: 'canonical-alarm' });
  assert.equal(clearFreezeByAlarmActor.ok, false);
  assert.equal(clearFreezeByAlarmActor.failure.code, 'OPERATOR_REQUIRED');
  assert.equal(world.commits.length, 1, 'alarm freeze-clear denial must not create a durable control receipt');
  assert.equal(world.publications.length, 1, 'alarm freeze-clear denial must not publish any runtime effect');

  const prefixedDigestWorld = controlWorld();
  const prefixedDigest = await routeCanonicalAlarmToKillSwitch({
    service: prefixedDigestWorld.service,
    alarm: alarm({ ownerDigest: `sha256:${'b'.repeat(64)}` }),
    evaluatedAtMs: NOW,
    maximumAgeMs: 1_000,
    expectedControlRevision: 0,
  });
  assert.equal(prefixedDigest.ok, true, 'the router must accept the canonical owner digest dialect');
});

test('[L-085] canonical alarm kill receipt survives a real Ledger restart', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  let publications = 0;
  const composition = {
    async inspectMutation() {
      throw new Error('fail-safe kill must not depend on composition inspection');
    },
    async publishCommitted() {
      publications += 1;
    },
  };
  try {
    let persistence = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(persistence.load(NOW - 1, 'alarm.halt.load').ok, true);
    let service = new SystemControlService({
      initialState: persistence.currentState().value.control,
      persistence,
      composition,
    });
    const first = await routeCanonicalAlarmToKillSwitch({
      service,
      alarm: alarm(),
      evaluatedAtMs: NOW,
      maximumAgeMs: 1_000,
      expectedControlRevision: 0,
    });
    assert.equal(first.ok, true);
    assert.equal(first.value.after.killSwitchEngaged, true);
    assert.equal(first.value.after.intakePaused, true);
    assert.equal(Number.isSafeInteger(first.value.ledgerEventId), true);
    assert.equal(publications, 1);
    ledger.close();

    ledger = new Ledger(dataDir);
    persistence = new SystemLedgerPersistenceAdapter(ledger);
    const loaded = persistence.load(NOW + 1, 'alarm.halt.reload');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.control.killSwitchEngaged, true);
    service = new SystemControlService({
      initialState: loaded.state.control,
      persistence,
      composition,
    });
    const replay = await routeCanonicalAlarmToKillSwitch({
      service,
      alarm: alarm(),
      evaluatedAtMs: NOW,
      maximumAgeMs: 1_000,
      expectedControlRevision: 0,
    });
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.value, first.value);
    assert.equal(publications, 1, 'durable replay after restart must not republish kill');
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});
