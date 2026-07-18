import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import { createProductIncidentOwner } from '../../../dist/productIntegration/incidents/index.js';
import {
  createProductIntegrationRuntime,
  productIncidentAcknowledgementControlId,
} from '../../../dist/productIntegration/runtime/index.js';
import { createProductRuntimeSystemControlCommandOwner } from '../../../dist/productIntegration/runtime/systemControlCommandOwner.js';
import { makeRead } from './testSupport.mjs';

const T0 = 1_910_000_000_000;
const INCIDENT_ID = 'incident.product.generic-command';
const ACTOR = Object.freeze({ id: 'operator.product.command', email: 'operator@example.test', source: 'cloudflare-access' });

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-incident-command-'));
}

function incidentInput(overrides = {}) {
  return Object.freeze({
    incidentId: INCIDENT_ID,
    fingerprint: 'fingerprint.product.generic-command',
    rootComponentId: 'public-usdm-source',
    severity: 'HIGH',
    capitalRelevant: true,
    expectedLedgerEventId: null,
    state: 'OPEN',
    firstSeenAtMs: T0 - 1_000,
    lastSeenAtMs: T0 - 500,
    eventCount: 9,
    acknowledgedAtMs: null,
    acknowledgedByOperatorId: null,
    resolvedAtMs: null,
    correlationId: 'cor.product.generic-command',
    audit: Object.freeze({
      kind: 'product.incident.opened',
      symbol: null,
      data: Object.freeze({ schema: 'cosmos.product-incident-open.v1', sourceEventIds: Object.freeze([901, 902]) }),
    }),
    ...overrides,
  });
}

function incidentOwner(ledger) {
  return createProductIncidentOwner(Object.freeze({
    readProductIncident: (incidentId) => ledger.readProductIncident(incidentId),
    readProductIncidentAcknowledgement: (incidentId, idempotencyKey) => (
      ledger.readProductIncidentAcknowledgement(incidentId, idempotencyKey)
    ),
    readProductIncidentCommandAcknowledgement: (idempotencyKey, controlId) => (
      ledger.readProductIncidentCommandAcknowledgement(idempotencyKey, controlId)
    ),
    compareAndTransitionProductIncident: (input) => ledger.compareAndTransitionProductIncident(input),
  }));
}

function harness(ledger, now) {
  let mutateCalls = 0;
  const controlState = Object.freeze({
    revision: 0,
    generation: 0,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: T0 - 10_000,
    correlationId: 'product.command.test.bootstrap',
  });
  const controls = Object.freeze({
    snapshot: () => controlState,
    mutate: async () => {
      mutateCalls += 1;
      throw new Error('incident ACK must never become a SystemControlMutation');
    },
    readResult: async () => null,
  });
  const incidents = incidentOwner(ledger);
  const owner = createProductRuntimeSystemControlCommandOwner({ controls, incidents });
  const service = createProductIntegrationRuntime({
    read: makeRead(),
    clock: { nowMs: () => now.value },
    commandOwner: owner,
  });
  return Object.freeze({ service, owner, incidents, controlState, mutateCalls: () => mutateCalls });
}

function commandRequest(controlId, incident, preview, idempotencyKey = 'incident.command.api.0001') {
  return Object.freeze({
    schemaVersion: 'product-command.v1',
    idempotencyKey,
    controlId,
    backendCommandId: 'ACK_INCIDENT',
    targetType: 'INCIDENT',
    targetId: incident.incidentId,
    payload: Object.freeze({ incidentId: incident.incidentId }),
    currentRevision: String(incident.ledgerEventId),
    expectedRevision: String(incident.ledgerEventId),
    previewId: preview.previewId,
    previewDigest: preview.digest,
    expiresAtMs: preview.expiresAtMs,
    reason: 'Responder accepts ownership while recovery remains separately proven.',
  });
}

function resultIdentity(idempotencyKey, controlId) {
  const canonical = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  };
  const digest = createHash('sha256').update(canonical({
    schema: 'product-command.v1', idempotencyKey, controlId,
  }), 'utf8').digest('hex');
  return Object.freeze({ commandId: `sysctrl_${digest}`, idempotencyKey, controlId });
}

test('PROV-004A uses generic Product preview/submit/result while ACK remains one atomic incident event', async () => {
  const dataDir = tempDataDir();
  const now = { value: T0 };
  let ledger = new Ledger(dataDir);
  try {
    const opened = ledger.compareAndTransitionProductIncident(incidentInput({ eventCount: 1 }));
    const original = ledger.readProductIncident(INCIDENT_ID);
    const world = harness(ledger, now);
    const controlId = productIncidentAcknowledgementControlId(INCIDENT_ID);
    const preview = await world.service.previewCommand({
      controlId,
      targetId: INCIDENT_ID,
      expectedRevision: String(opened.ledgerEvent.id),
      operator: ACTOR,
    });
    const request = commandRequest(controlId, original, preview);
    const applied = await world.service.submitCommand(request, ACTOR);
    assert.equal(applied.status, 'APPLIED');
    assert.match(applied.receiptId, /^ledger-event:[1-9][0-9]*$/);
    assert.equal(world.mutateCalls(), 0);
    assert.equal(world.controlState.revision, 0);

    const after = ledger.readProductIncident(INCIDENT_ID);
    assert.deepEqual({
      fingerprint: after.fingerprint,
      rootComponentId: after.rootComponentId,
      severity: after.severity,
      capitalRelevant: after.capitalRelevant,
      firstSeenAtMs: after.firstSeenAtMs,
      lastSeenAtMs: after.lastSeenAtMs,
      eventCount: after.eventCount,
      correlationId: after.correlationId,
      resolvedAtMs: after.resolvedAtMs,
    }, {
      fingerprint: original.fingerprint,
      rootComponentId: original.rootComponentId,
      severity: original.severity,
      capitalRelevant: original.capitalRelevant,
      firstSeenAtMs: original.firstSeenAtMs,
      lastSeenAtMs: original.lastSeenAtMs,
      eventCount: original.eventCount,
      correlationId: original.correlationId,
      resolvedAtMs: original.resolvedAtMs,
    });
    assert.equal(after.state, 'ACKNOWLEDGED');
    assert.equal(ledger.countEvents('incident_acknowledged'), 1);
    const event = ledger.readProductIncidentCommandAcknowledgement(request.idempotencyKey, controlId);
    assert.equal(event.data.schema, 'cosmos.product-incident-ack.v2');
    assert.equal(event.data.command.backendCommandId, 'ACK_INCIDENT');
    assert.equal(event.data.command.targetType, 'INCIDENT');
    assert.equal(event.data.command.targetId, INCIDENT_ID);
    assert.equal(event.data.command.controlId, controlId);
    assert.equal(event.data.externalActionAuthorization, 'NONE');

    const identity = resultIdentity(request.idempotencyKey, controlId);
    const terminal = await world.service.readCommandResult(identity);
    assert.equal(terminal.state, 'TERMINAL');
    assert.deepEqual(terminal.result, applied, 'first result and immutable readback must be byte-equivalent');
    const replay = await world.service.submitCommand(request, ACTOR);
    assert.equal(replay.status, 'ALREADY_APPLIED');
    assert.equal(replay.receiptId, applied.receiptId);
    assert.equal(ledger.countEvents('incident_acknowledged'), 1);
    assert.equal(world.mutateCalls(), 0);

    ledger.close();
    ledger = new Ledger(dataDir);
    const restarted = harness(ledger, now);
    const afterRestart = await restarted.service.readCommandResult(identity);
    assert.deepEqual(afterRestart, terminal);
    assert.equal(restarted.mutateCalls(), 0);

    const acknowledged = ledger.readProductIncident(INCIDENT_ID);
    ledger.compareAndTransitionProductIncident(incidentInput({
      expectedLedgerEventId: acknowledged.ledgerEventId,
      state: 'RESOLVED',
      firstSeenAtMs: acknowledged.firstSeenAtMs,
      lastSeenAtMs: acknowledged.lastSeenAtMs + 1_000,
      eventCount: acknowledged.eventCount + 1,
      acknowledgedAtMs: acknowledged.acknowledgedAtMs,
      acknowledgedByOperatorId: acknowledged.acknowledgedByOperatorId,
      resolvedAtMs: acknowledged.lastSeenAtMs + 1_000,
      audit: Object.freeze({
        kind: 'product.incident.resolved',
        symbol: null,
        data: Object.freeze({ schema: 'cosmos.product-incident-recovery.v1', recoveryProven: true }),
      }),
    }));
    const afterRecovery = await restarted.service.readCommandResult(identity);
    assert.deepEqual(afterRecovery, terminal, 'later recovery cannot erase or rewrite the ACK receipt');
    assert.equal(ledger.readProductIncident(INCIDENT_ID).state, 'RESOLVED');
  } finally {
    try { ledger.close(); } catch { /* already closed */ }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('PROV-004A rejects stale, forged, cross-incident, actor, and idempotency conflicts without System mutation', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  const now = { value: T0 };
  try {
    const opened = ledger.compareAndTransitionProductIncident(incidentInput({ eventCount: 1 }));
    const incident = ledger.readProductIncident(INCIDENT_ID);
    const world = harness(ledger, now);
    const controlId = productIncidentAcknowledgementControlId(INCIDENT_ID);

    await assert.rejects(
      world.service.previewCommand({
        controlId,
        targetId: INCIDENT_ID,
        expectedRevision: String(opened.ledgerEvent.id - 1),
        operator: ACTOR,
      }),
      (error) => error?.code === 'REJECTED_STALE_REVISION',
    );
    await assert.rejects(
      world.service.previewCommand({
        controlId,
        targetId: 'incident.product.cross-target',
        expectedRevision: String(opened.ledgerEvent.id),
        operator: ACTOR,
      }),
      (error) => error?.code === 'CONTROL_PREVIEW_INVALID',
    );

    const preview = await world.service.previewCommand({
      controlId,
      targetId: INCIDENT_ID,
      expectedRevision: String(opened.ledgerEvent.id),
      operator: ACTOR,
    });
    const request = commandRequest(controlId, incident, preview, 'incident.command.hostile.0001');
    const forgedPreview = await world.service.submitCommand({
      ...request, previewDigest: `sha256:${'f'.repeat(64)}`,
    }, ACTOR);
    assert.equal(forgedPreview.status, 'REJECTED_AUTHORITY');
    assert.equal(ledger.countEvents('incident_acknowledged'), 0);

    const applied = await world.service.submitCommand(request, ACTOR);
    assert.equal(applied.status, 'APPLIED');
    const foreignActor = await world.service.submitCommand(request, {
      id: 'operator.product.foreign', email: null, source: 'cloudflare-access',
    });
    assert.equal(foreignActor.status, 'REJECTED_AUTHORITY');
    const changedReason = await world.service.submitCommand({
      ...request, reason: 'Conflicting reuse of the same Product command identity.',
    }, ACTOR);
    assert.equal(changedReason.status, 'REJECTED_SCHEMA');
    assert.equal(ledger.countEvents('incident_acknowledged'), 1);
    assert.equal(world.mutateCalls(), 0);

    const wrongControl = productIncidentAcknowledgementControlId('incident.product.other');
    await assert.rejects(
      world.service.submitCommand({
        ...request,
        controlId: wrongControl,
        targetId: INCIDENT_ID,
        payload: Object.freeze({ incidentId: INCIDENT_ID }),
      }, ACTOR),
      (error) => error?.code === 'CONTROL_PREVIEW_INVALID',
    );
    assert.equal(ledger.countEvents('incident_acknowledged'), 1);

    const durable = ledger.readProductIncidentCommandAcknowledgement(request.idempotencyKey, controlId);
    ledger.db.prepare('INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)').run(
      durable.ts + 1,
      durable.kind,
      durable.symbol,
      JSON.stringify(durable.data),
    );
    assert.throws(
      () => ledger.readProductIncidentCommandAcknowledgement(request.idempotencyKey, controlId),
      /duplicate durable product incident command receipts/,
    );
    const duplicateReadback = await world.service.readCommandResult(resultIdentity(request.idempotencyKey, controlId));
    assert.deepEqual(duplicateReadback, {
      state: 'FAIL_CLOSED',
      result: null,
      failureCode: 'INCIDENT_RESULT_OWNER_UNAVAILABLE',
    });
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
