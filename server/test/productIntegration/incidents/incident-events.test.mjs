import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import { createProductIncidentOwner } from '../../../dist/productIntegration/incidents/index.js';
import { PRODUCT_INCIDENT_ACK_EVENT_KIND } from '../../../dist/systemIntegration/persistence/index.js';

const T0 = 1_800_100_000_000;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-incident-events-'));
}

function incidentInput(overrides = {}) {
  return Object.freeze({
    incidentId: 'incident.product.event-path',
    fingerprint: 'fingerprint.product.event-path',
    rootComponentId: 'market-streams',
    severity: 'CRITICAL',
    capitalRelevant: false,
    expectedLedgerEventId: null,
    state: 'OPEN',
    firstSeenAtMs: T0,
    lastSeenAtMs: T0,
    eventCount: 1,
    acknowledgedAtMs: null,
    acknowledgedByOperatorId: null,
    resolvedAtMs: null,
    correlationId: 'cor.product.incident.event-path',
    audit: Object.freeze({
      kind: 'product.incident.opened',
      symbol: null,
      data: Object.freeze({
        schema: 'cosmos.product-incident-open.v1',
        sourceEventIds: Object.freeze([41]),
        rootCause: 'PUBLIC_SOURCE_STALE',
      }),
    }),
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

function request(expectedLedgerEventId) {
  return Object.freeze({
    incidentId: 'incident.product.event-path',
    expectedLedgerEventId,
    idempotencyKey: 'incident.ack.event-path.0001',
    actor: Object.freeze({ id: 'operator.digest.events', source: 'cloudflare-access' }),
    acknowledgedAtMs: T0 + 10,
    reason: 'Responder accepted ownership while the source evidence remains open.',
  });
}

test('MIS-080 adds one immutable /api/events ACK row without deleting source evidence or using product_operator_events', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const opened = ledger.compareAndTransitionProductIncident(incidentInput());
    const sourceEvent = opened.ledgerEvent;
    const acknowledged = owner(ledger).acknowledge(request(sourceEvent.id));
    assert.equal(acknowledged.ok, true);
    assert.equal(acknowledged.status, 'ACKNOWLEDGED');

    const acknowledgements = ledger.recentEvents(2_000, PRODUCT_INCIDENT_ACK_EVENT_KIND);
    assert.equal(acknowledgements.length, 1);
    assert.equal(acknowledgements[0].id, acknowledged.incident.ledgerEventId);
    assert.equal(acknowledgements[0].data.schema, 'cosmos.product-incident-ack.v1');
    assert.equal(acknowledgements[0].data.before.rootComponentId, 'market-streams');
    assert.equal(acknowledgements[0].data.after.rootComponentId, 'market-streams');
    assert.equal(acknowledgements[0].data.before.eventCount, 1);
    assert.equal(acknowledgements[0].data.after.eventCount, 1);
    assert.equal(acknowledgements[0].data.after.state, 'ACKNOWLEDGED');

    assert.equal(ledger.recentEvents(2_000, 'product.incident.opened')[0].id, sourceEvent.id);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_operator_events').get().count, 0);
    const eventCount = ledger.countEvents();
    const incidentBytes = JSON.stringify(ledger.readProductIncident('incident.product.event-path'));
    const firstGet = ledger.recentEvents(2_000, PRODUCT_INCIDENT_ACK_EVENT_KIND);
    const secondGet = ledger.recentEvents(2_000, PRODUCT_INCIDENT_ACK_EVENT_KIND);
    assert.deepEqual(secondGet, firstGet);
    assert.equal(ledger.countEvents(), eventCount, 'repeated event GET-equivalent reads cannot append');
    assert.equal(JSON.stringify(ledger.readProductIncident('incident.product.event-path')), incidentBytes);

    const applicationSource = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
    assert.match(applicationSource, /app\.get\('\/api\/events'/);
    assert.match(applicationSource, /ledger\.recentEvents\(/);
    const ownerSource = readFileSync(new URL('../../../src/productIntegration/incidents/owner.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(ownerSource, /product_operator_events|logEvent\(/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('MIS-080 exact ACK replay survives a later recovery transition by reading immutable history', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const opened = ledger.compareAndTransitionProductIncident(incidentInput());
    const input = request(opened.ledgerEvent.id);
    const acknowledged = owner(ledger).acknowledge(input);
    assert.equal(acknowledged.ok, true);
    const current = ledger.readProductIncident(input.incidentId);
    const recovered = ledger.compareAndTransitionProductIncident(Object.freeze({
      incidentId: current.incidentId,
      fingerprint: current.fingerprint,
      rootComponentId: current.rootComponentId,
      severity: current.severity,
      capitalRelevant: current.capitalRelevant,
      expectedLedgerEventId: current.ledgerEventId,
      state: 'RESOLVED',
      firstSeenAtMs: current.firstSeenAtMs,
      lastSeenAtMs: T0 + 20,
      eventCount: current.eventCount,
      acknowledgedAtMs: current.acknowledgedAtMs,
      acknowledgedByOperatorId: current.acknowledgedByOperatorId,
      resolvedAtMs: T0 + 20,
      correlationId: current.correlationId,
      audit: Object.freeze({
        kind: 'product.incident.recovered',
        symbol: null,
        data: Object.freeze({
          schema: 'cosmos.product-incident-recovery.v1',
          incidentId: current.incidentId,
          recoveryProof: 'CANONICAL_OWNER_RECOVERED',
        }),
      }),
    }));
    assert.equal(recovered.disposition, 'COMMITTED_NEW');
    assert.notEqual(recovered.ledgerEvent.id, acknowledged.incident.ledgerEventId);
    ledger.close();

    ledger = new Ledger(dataDir);
    const count = ledger.countEvents();
    const replay = owner(ledger).acknowledge(input);
    assert.equal(replay.ok, true);
    assert.equal(replay.status, 'ALREADY_ACKNOWLEDGED');
    assert.equal(replay.receiptId, acknowledged.receiptId);
    assert.equal(replay.incident.state, 'ACKNOWLEDGED', 'readback is the immutable ACK result, not a rewritten current row');
    assert.equal(ledger.readProductIncident(input.incidentId).state, 'RESOLVED');
    assert.equal(ledger.countEvents(), count);
    assert.equal(ledger.readProductIncidentAcknowledgement(
      input.incidentId,
      input.idempotencyKey,
    ).id, acknowledged.incident.ledgerEventId);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('MIS-080 duplicate acknowledgement history fails closed instead of selecting one event', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const opened = ledger.compareAndTransitionProductIncident(incidentInput());
    const input = request(opened.ledgerEvent.id);
    const acknowledged = owner(ledger).acknowledge(input);
    assert.equal(acknowledged.ok, true);
    const event = ledger.readProductIncidentAcknowledgement(input.incidentId, input.idempotencyKey);
    ledger.logEvent(event.kind, event.symbol, event.data);
    assert.throws(
      () => ledger.readProductIncidentAcknowledgement(input.incidentId, input.idempotencyKey),
      /duplicate durable product incident acknowledgement events/,
    );
    const result = owner(ledger).acknowledge(input);
    assert.deepEqual(result, {
      ok: false,
      code: 'INCIDENT_PERSISTENCE_UNAVAILABLE',
      currentLedgerEventId: null,
    });
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
