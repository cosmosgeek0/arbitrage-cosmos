import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import { createProductIncidentOwner } from '../../../dist/productIntegration/incidents/index.js';

const T0 = 1_800_000_000_000;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-incident-owner-'));
}

function seedIncident(ledger, suffix = 'one', overrides = {}) {
  return ledger.compareAndTransitionProductIncident(Object.freeze({
    incidentId: `incident.product.${suffix}`,
    fingerprint: `fingerprint.product.${suffix}`,
    rootComponentId: 'basis-engine',
    severity: 'CRITICAL',
    capitalRelevant: true,
    expectedLedgerEventId: null,
    state: 'OPEN',
    firstSeenAtMs: T0,
    lastSeenAtMs: T0 + 5,
    eventCount: 1,
    acknowledgedAtMs: null,
    acknowledgedByOperatorId: null,
    resolvedAtMs: null,
    correlationId: `cor.product.incident.${suffix}`,
    audit: Object.freeze({
      kind: 'product.incident.opened',
      symbol: null,
      data: Object.freeze({ schema: 'cosmos.product-incident-open.v1', suffix }),
    }),
    ...overrides,
  }));
}

function request(opened, suffix = 'one', overrides = {}) {
  return Object.freeze({
    incidentId: `incident.product.${suffix}`,
    expectedLedgerEventId: opened.ledgerEvent.id,
    idempotencyKey: `incident.ack.${suffix}.0001`,
    actor: Object.freeze({ id: 'operator.digest.one', source: 'loopback' }),
    acknowledgedAtMs: T0 + 10,
    reason: 'Operator owns the incident response without clearing the cause.',
    ...overrides,
  });
}

function owner(ledger) {
  return createProductIncidentOwner(Object.freeze({
    readProductIncident: (incidentId) => ledger.readProductIncident(incidentId),
    readProductIncidentAcknowledgement: (incidentId, idempotencyKey) => (
      ledger.readProductIncidentAcknowledgement(incidentId, idempotencyKey)
    ),
    compareAndTransitionProductIncident: (input) => ledger.compareAndTransitionProductIncident(input),
  }));
}

test('I00-044A acknowledges once by sole-Ledger revision and preserves incident truth across restart', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const opened = seedIncident(ledger);
    const before = ledger.readProductIncident('incident.product.one');
    const input = request(opened);
    const first = owner(ledger).acknowledge(input);
    assert.equal(first.ok, true);
    assert.equal(first.status, 'ACKNOWLEDGED');
    assert.equal(first.receiptId, `ledger-event:${first.incident.ledgerEventId}`);
    assert.deepEqual({
      fingerprint: first.incident.fingerprint,
      rootComponentId: first.incident.rootComponentId,
      severity: first.incident.severity,
      capitalRelevant: first.incident.capitalRelevant,
      firstSeenAtMs: first.incident.firstSeenAtMs,
      lastSeenAtMs: first.incident.lastSeenAtMs,
      eventCount: first.incident.eventCount,
      resolvedAtMs: first.incident.resolvedAtMs,
      correlationId: first.incident.correlationId,
    }, {
      fingerprint: before.fingerprint,
      rootComponentId: before.rootComponentId,
      severity: before.severity,
      capitalRelevant: before.capitalRelevant,
      firstSeenAtMs: before.firstSeenAtMs,
      lastSeenAtMs: before.lastSeenAtMs,
      eventCount: before.eventCount,
      resolvedAtMs: before.resolvedAtMs,
      correlationId: before.correlationId,
    });
    assert.equal(first.incident.state, 'ACKNOWLEDGED');
    assert.equal(first.incident.acknowledgedAtMs, T0 + 10);
    assert.equal(first.incident.acknowledgedByOperatorId, 'operator.digest.one');
    assert.equal(first.incident.lastAudit.data.externalActionAuthorization, 'NONE');
    assert.equal(ledger.countEvents(), 2);
    ledger.close();

    ledger = new Ledger(dataDir);
    const replay = owner(ledger).acknowledge(input);
    assert.equal(replay.ok, true);
    assert.equal(replay.status, 'ALREADY_ACKNOWLEDGED');
    assert.equal(replay.receiptId, first.receiptId);
    assert.equal(ledger.countEvents(), 2, 'restart replay appends no second acknowledgement');

    const conflictingKey = owner(ledger).acknowledge(request(opened, 'one', {
      idempotencyKey: 'incident.ack.one.other',
    }));
    assert.deepEqual(conflictingKey, {
      ok: false,
      code: 'INCIDENT_ACK_IDEMPOTENCY_CONFLICT',
      currentLedgerEventId: first.incident.ledgerEventId,
    });
    assert.equal(ledger.countEvents(), 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-044A serializes hostile writers on ledgerEventId even when event_count does not change', () => {
  const dataDir = tempDataDir();
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  try {
    const opened = seedIncident(firstLedger, 'race');
    const first = owner(firstLedger).acknowledge(request(opened, 'race'));
    assert.equal(first.ok, true);

    const loser = owner(secondLedger).acknowledge(request(opened, 'race', {
      idempotencyKey: 'incident.ack.race.loser',
      actor: Object.freeze({ id: 'operator.digest.two', source: 'cloudflare-access' }),
      acknowledgedAtMs: T0 + 11,
    }));
    assert.equal(loser.ok, false);
    assert.equal(loser.code, 'INCIDENT_ACK_IDEMPOTENCY_CONFLICT');
    assert.equal(secondLedger.readProductIncident('incident.product.race').eventCount, 1);
    assert.equal(secondLedger.countEvents('incident_acknowledged'), 1);

    const revisionOpened = seedIncident(firstLedger, 'revision');
    const current = firstLedger.readProductIncident('incident.product.revision');
    const advanced = firstLedger.compareAndTransitionProductIncident(Object.freeze({
      incidentId: current.incidentId,
      fingerprint: current.fingerprint,
      rootComponentId: current.rootComponentId,
      severity: current.severity,
      capitalRelevant: current.capitalRelevant,
      expectedLedgerEventId: current.ledgerEventId,
      state: current.state,
      firstSeenAtMs: current.firstSeenAtMs,
      lastSeenAtMs: current.lastSeenAtMs + 1,
      eventCount: current.eventCount,
      acknowledgedAtMs: null,
      acknowledgedByOperatorId: null,
      resolvedAtMs: null,
      correlationId: current.correlationId,
      audit: Object.freeze({
        kind: 'product.incident.transition',
        symbol: null,
        data: Object.freeze({ schema: 'cosmos.product-incident-owner-refresh.v1' }),
      }),
    }));
    assert.equal(advanced.disposition, 'COMMITTED_NEW');
    assert.equal(firstLedger.readProductIncident(current.incidentId).eventCount, 1);
    const stale = owner(secondLedger).acknowledge(request(revisionOpened, 'revision'));
    assert.deepEqual(stale, {
      ok: false,
      code: 'INCIDENT_REVISION_CONFLICT',
      currentLedgerEventId: advanced.ledgerEvent.id,
    });
  } finally {
    firstLedger.close();
    secondLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-044A fails closed for malformed input, resolved state, and partial persistence', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const opened = seedIncident(ledger, 'failure');
    const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    assert.deepEqual(owner(ledger).acknowledge(proxy), {
      ok: false,
      code: 'ACK_REQUEST_INVALID',
      currentLedgerEventId: null,
    });

    ledger.db.exec(`
      CREATE TRIGGER reject_incident_ack
      BEFORE UPDATE ON product_incidents
      BEGIN SELECT RAISE(ABORT, 'incident ack rejected'); END;
    `);
    const eventCount = ledger.countEvents();
    const failed = owner(ledger).acknowledge(request(opened, 'failure'));
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'INCIDENT_PERSISTENCE_UNAVAILABLE');
    assert.equal(ledger.countEvents(), eventCount, 'audit append rolls back with incident update');
    assert.equal(ledger.readProductIncident('incident.product.failure').acknowledgedAtMs, null);
    ledger.db.exec('DROP TRIGGER reject_incident_ack');

    seedIncident(ledger, 'resolved');
    const resolvedBefore = ledger.readProductIncident('incident.product.resolved');
    const resolvedTransition = ledger.compareAndTransitionProductIncident(Object.freeze({
      incidentId: resolvedBefore.incidentId,
      fingerprint: resolvedBefore.fingerprint,
      rootComponentId: resolvedBefore.rootComponentId,
      severity: resolvedBefore.severity,
      capitalRelevant: resolvedBefore.capitalRelevant,
      expectedLedgerEventId: resolvedBefore.ledgerEventId,
      state: 'RESOLVED',
      firstSeenAtMs: resolvedBefore.firstSeenAtMs,
      lastSeenAtMs: T0 + 8,
      eventCount: resolvedBefore.eventCount,
      acknowledgedAtMs: null,
      acknowledgedByOperatorId: null,
      resolvedAtMs: T0 + 8,
      correlationId: resolvedBefore.correlationId,
      audit: Object.freeze({
        kind: 'product.incident.resolved',
        symbol: null,
        data: Object.freeze({
          schema: 'cosmos.product-incident-recovery.v1',
          incidentId: resolvedBefore.incidentId,
        }),
      }),
    }));
    const resolved = owner(ledger).acknowledge(request(resolvedTransition, 'resolved'));
    assert.deepEqual(resolved, {
      ok: false,
      code: 'INCIDENT_ALREADY_RESOLVED',
      currentLedgerEventId: resolvedTransition.ledgerEvent.id,
    });
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-044A rejects invalid durable incident vocabulary, lifecycle, capital, and audit relationships', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const eventCount = ledger.countEvents();
    assert.throws(() => seedIncident(ledger, 'bad-severity', { severity: 'WARNING' }), /severity must be/);
    assert.throws(() => seedIncident(ledger, 'bad-state', { state: 'INVESTIGATING' }), /state must be/);
    assert.throws(() => seedIncident(ledger, 'bad-open-ack', {
      acknowledgedAtMs: T0 + 1,
      acknowledgedByOperatorId: 'operator.invalid.open',
    }), /state fields are inconsistent/);
    assert.throws(() => seedIncident(ledger, 'bad-resolved-new', {
      state: 'RESOLVED',
      lastSeenAtMs: T0 + 8,
      resolvedAtMs: T0 + 8,
    }), /must begin OPEN/);
    assert.equal(ledger.countEvents(), eventCount, 'invalid inputs append no audit rows');

    const opened = seedIncident(ledger, 'corrupt');
    const acknowledgement = owner(ledger).acknowledge(request(opened, 'corrupt'));
    assert.equal(acknowledgement.ok, true);
    const incidentId = 'incident.product.corrupt';

    ledger.db.pragma('ignore_check_constraints = ON');
    ledger.db.prepare('UPDATE product_incidents SET capital_relevant = 2 WHERE incident_id = ?').run(incidentId);
    assert.throws(() => ledger.readProductIncident(incidentId), /capital relevance is invalid/);
    ledger.db.prepare('UPDATE product_incidents SET capital_relevant = 1 WHERE incident_id = ?').run(incidentId);

    ledger.db.prepare("UPDATE product_incidents SET severity = 'WARNING' WHERE incident_id = ?").run(incidentId);
    assert.throws(() => ledger.readProductIncident(incidentId), /severity must be/);
    ledger.db.prepare("UPDATE product_incidents SET severity = 'CRITICAL' WHERE incident_id = ?").run(incidentId);

    ledger.db.prepare("UPDATE product_incidents SET state = 'OPEN' WHERE incident_id = ?").run(incidentId);
    assert.throws(() => ledger.readProductIncident(incidentId), /state fields are inconsistent/);
    ledger.db.prepare("UPDATE product_incidents SET state = 'ACKNOWLEDGED' WHERE incident_id = ?").run(incidentId);
    ledger.db.pragma('ignore_check_constraints = OFF');

    const auditId = acknowledgement.incident.ledgerEventId;
    const auditBytes = ledger.db.prepare('SELECT data FROM events WHERE id = ?').get(auditId).data;
    ledger.db.prepare(`
      UPDATE events
      SET data = json_set(data, '$.after.rootComponentId', 'volume-engine')
      WHERE id = ?
    `).run(auditId);
    assert.throws(() => ledger.readProductIncident(incidentId), /audit relationship is invalid/);
    ledger.db.prepare('UPDATE events SET data = ? WHERE id = ?').run(auditBytes, auditId);

    const repaired = ledger.readProductIncident(incidentId);
    assert.equal(repaired.rootComponentId, 'basis-engine');
    assert.equal(repaired.state, 'ACKNOWLEDGED');
    assert.equal(ledger.countEvents(), eventCount + 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
