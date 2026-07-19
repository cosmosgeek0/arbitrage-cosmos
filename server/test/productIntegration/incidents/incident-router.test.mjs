import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  createProductIncidentOwner,
  createProductIncidentRouter,
} from '../../../dist/productIntegration/incidents/index.js';

// The unconditional append-only triggers block every SQL writer; a hostile
// writer with direct file access can simply drop them first, so the checkpoint
// trigger chain probed below must hold even without them. Drop, mutate,
// restore — the canonical schema stays intact for the rest of the test.
function withoutAppendOnlyTriggers(db, mutate) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name IN ('events_no_update', 'events_no_delete_durable')
    ORDER BY name ASC
  `).all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
  try {
    return mutate();
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-incident-router-'));
}

function persistence(ledger) {
  return Object.freeze({
    readProductIncident: (incidentId) => ledger.readProductIncident(incidentId),
    readProductIncidentSourceEvent: (sourceEventId) => ledger.readProductIncidentSourceEvent(sourceEventId),
    readProductIncidentsByFingerprintPrefix: (fingerprintPrefix, limit) => (
      ledger.readProductIncidentsByFingerprintPrefix(fingerprintPrefix, limit)
    ),
    countProductIncidentsByFingerprintPrefix: (fingerprintPrefix) => (
      ledger.countProductIncidentsByFingerprintPrefix(fingerprintPrefix)
    ),
    readProductIncidentRoutingBySourceEventId: (sourceEventId) => (
      ledger.readProductIncidentRoutingBySourceEventId(sourceEventId)
    ),
    readProductIncidentRoutingByReceiptEventId: (receiptEventId) => (
      ledger.readProductIncidentRoutingByReceiptEventId(receiptEventId)
    ),
    readLatestProductIncidentSourceDisposition: (componentId, sourceGroup) => (
      ledger.readLatestProductIncidentSourceDisposition(componentId, sourceGroup)
    ),
    readPreviousProductIncidentSourceDisposition: (componentId, sourceGroup, beforeSourceEventId) => (
      ledger.readPreviousProductIncidentSourceDisposition(componentId, sourceGroup, beforeSourceEventId)
    ),
    readPreviousProductIncidentRoutedDisposition: (componentId, sourceGroup, beforeSourceEventId) => (
      ledger.readPreviousProductIncidentRoutedDisposition(componentId, sourceGroup, beforeSourceEventId)
    ),
    readProductIncidentAcknowledgementByIncidentId: (incidentId) => (
      ledger.readProductIncidentAcknowledgementByIncidentId(incidentId)
    ),
    readProductIncidentOpeningRoutingByIncidentId: (incidentId) => (
      ledger.readProductIncidentOpeningRoutingByIncidentId(incidentId)
    ),
    readProductIncidentRotationByIncidentId: (incidentId) => (
      ledger.readProductIncidentRotationByIncidentId(incidentId)
    ),
    readOldestResolvedProductIncidentByFingerprintPrefix: (fingerprintPrefix) => (
      ledger.readOldestResolvedProductIncidentByFingerprintPrefix(fingerprintPrefix)
    ),
    compareAndTransitionProductIncident: (input) => ledger.compareAndTransitionProductIncident(input),
    compareAndRotateResolvedProductIncident: (input) => ledger.compareAndRotateResolvedProductIncident(input),
    recordProductIncidentSourceDisposition: (audit) => ledger.recordProductIncidentSourceDisposition(audit),
    advanceProductIncidentRouterCheckpoint: (sourceEventId) => (
      ledger.advanceProductIncidentRouterCheckpoint(sourceEventId)
    ),
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

function source(ledger, kind, status, detail = status) {
  const observedAt = 1_700_000_000_000 + ledger.countEvents();
  return ledger.logEvent(kind, null, Object.freeze({
    componentId: 'market-streams',
    group: 'binance',
    status,
    detail,
    observedAt,
  }));
}

test('I00-050 groups a flood into one durable episode, preserves ACK, proves recovery, and opens recurrence', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));

    const degraded = source(ledger, 'connection_alert', 'degraded', 'books delayed');
    assert.equal(router.ingest(degraded).disposition, 'OPENED');
    const outage = source(ledger, 'connection_alert', 'outage', 'all books disconnected');
    assert.equal(router.ingest(outage).disposition, 'GROUPED');

    let snapshot = router.readProjection();
    const openingRoutingReceipt = snapshot.incidents[0].routing.inApp.receiptId;
    assert.equal(snapshot.availability.state, 'AVAILABLE');
    assert.equal(snapshot.incidents.length, 1);
    assert.deepEqual({
      state: snapshot.incidents[0].state,
      severity: snapshot.incidents[0].severity,
      capitalRelevant: snapshot.incidents[0].capitalRelevant,
      count: snapshot.incidents[0].count,
      inApp: snapshot.incidents[0].routing.inApp.state,
      external: snapshot.incidents[0].routing.externalPaging,
      recovery: snapshot.incidents[0].recoveryProof,
    }, {
      state: 'OPEN',
      severity: 'CRITICAL',
      capitalRelevant: true,
      count: 2,
      inApp: 'WIRED_LOCAL',
      external: {
        state: 'NOT_CONFIGURED',
        receiptId: null,
        blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED',
      },
      recovery: { state: 'PENDING', sourceEventId: null, resolvedAtMs: null },
    });

    const beforeReplayCount = ledger.countEvents();
    assert.equal(router.ingest(outage).disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(ledger.countEvents(), beforeReplayCount);
    const incident = snapshot.incidents[0];
    const acknowledgement = incidentOwner(ledger).acknowledge(Object.freeze({
      incidentId: incident.incidentId,
      expectedLedgerEventId: incident.ledgerEventId,
      idempotencyKey: 'incident.router.ack.0001',
      actor: Object.freeze({ id: 'operator.router.test', source: 'loopback' }),
      acknowledgedAtMs: outage.data.observedAt + 1,
      reason: 'Operator accepted the local incident while awaiting explicit recovery.',
    }));
    assert.equal(acknowledgement.ok, true);

    const repeat = source(ledger, 'connection_alert', 'degraded', 'books remain delayed');
    assert.equal(router.ingest(repeat).disposition, 'GROUPED');
    snapshot = router.readProjection();
    assert.equal(snapshot.incidents[0].state, 'ACKNOWLEDGED');
    assert.equal(snapshot.incidents[0].count, 3);
    assert.equal(snapshot.incidents[0].acknowledgedByOperatorId, 'operator.router.test');
    assert.equal(snapshot.incidents[0].routing.inApp.receiptId, openingRoutingReceipt);
    const groupedEpisode = snapshot.incidents[0];
    ledger.db.prepare(`
      UPDATE product_incidents
      SET event_count = event_count + 1, last_seen_at_ms = last_seen_at_ms + 1
      WHERE incident_id = ?
    `).run(groupedEpisode.incidentId);
    assert.equal(router.readProjection().availability.blocker,
      'INCIDENT_ROUTER_READBACK_INVALID',
      'a semantically valid row rewrite cannot escape the full route-audit binding');
    ledger.db.prepare(`
      UPDATE product_incidents
      SET event_count = ?, last_seen_at_ms = ?
      WHERE incident_id = ?
    `).run(groupedEpisode.count, groupedEpisode.lastSeenAtMs, groupedEpisode.incidentId);
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');

    const recovered = source(ledger, 'connection_recovered', 'operational', 'books current');
    assert.equal(router.ingest(recovered).disposition, 'RESOLVED');
    snapshot = router.readProjection();
    const resolvedEpisode = snapshot.incidents[0];
    assert.equal(resolvedEpisode.state, 'RESOLVED');
    assert.equal(resolvedEpisode.count, 4);
    assert.equal(resolvedEpisode.acknowledgedByOperatorId, 'operator.router.test');
    assert.equal(resolvedEpisode.routing.inApp.receiptId, openingRoutingReceipt);
    assert.deepEqual(resolvedEpisode.recoveryProof, {
      state: 'PROVEN', sourceEventId: recovered.id, resolvedAtMs: recovered.data.observedAt,
    });
    const recoveredSourceBytes = ledger.db.prepare('SELECT data FROM events WHERE id = ?').get(recovered.id).data;
    withoutAppendOnlyTriggers(ledger.db, () => {
      assert.throws(() => ledger.db.prepare(`
        UPDATE events
        SET data = json_set(data, '$.observedAt', json_extract(data, '$.observedAt') + 1)
        WHERE id = ?
      `).run(recovered.id), /checkpoint evidence is immutable/);
      assert.throws(() => ledger.db.prepare('DELETE FROM events WHERE id = ?').run(recovered.id),
        /checkpoint evidence is immutable/);
    });
    assert.equal(ledger.db.prepare('SELECT data FROM events WHERE id = ?').get(recovered.id).data,
      recoveredSourceBytes, 'checkpoint triggers preserve the exact recovery-source bytes');
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');
    const lateAlert = ledger.logEvent('connection_alert', null, Object.freeze({
      componentId: 'market-streams',
      group: 'binance',
      status: 'outage',
      detail: 'late alert after proven recovery',
      observedAt: recovered.data.observedAt - 1,
    }));
    assert.equal(router.ingest(lateAlert).disposition, 'IGNORED');
    assert.equal(router.readProjection().incidents.length, 1);
    assert.equal(router.readProjection().incidents[0].state, 'RESOLVED');
    const resolvedIncidentId = resolvedEpisode.incidentId;
    const resolvedReceipt = resolvedEpisode.routing.inApp.receiptId;
    const eventCountBeforeRestart = ledger.countEvents();

    ledger.close();
    ledger = new Ledger(dataDir);
    router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(ledger.readProductIncidentSourceEvents(0, 500));
    assert.equal(ledger.countEvents(), eventCountBeforeRestart,
      'restart catch-up deduplicates every already-routed source event');
    assert.equal(router.readProjection().incidents[0].incidentId, resolvedIncidentId);
    assert.equal(router.readProjection().incidents[0].routing.inApp.receiptId, resolvedReceipt);

    const recurrence = source(ledger, 'connection_alert', 'outage', 'books disconnected again');
    assert.equal(router.ingest(recurrence).disposition, 'OPENED');
    snapshot = router.readProjection();
    assert.equal(snapshot.incidents.length, 2);
    assert.equal(snapshot.incidents[0].state, 'OPEN');
    assert.notEqual(snapshot.incidents[0].incidentId, resolvedIncidentId);
    assert.equal(snapshot.incidents[0].count, 1);
    assert.equal(snapshot.incidents[1].incidentId, resolvedIncidentId);
    assert.equal(snapshot.incidents[1].state, 'RESOLVED');
    assert.equal(snapshot.incidents[1].routing.inApp.receiptId, resolvedReceipt);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 projection reads are byte-stable, bounded, and never ingest on GET-equivalent access', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const event = source(ledger, 'connection_alert', 'degraded');
    const router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([event]));
    const eventCount = ledger.countEvents();
    const first = JSON.stringify(router.readProjection());
    const second = JSON.stringify(router.readProjection());
    assert.equal(second, first);
    assert.equal(ledger.countEvents(), eventCount);

    const regressedRecovery = ledger.logEvent('connection_recovered', null, Object.freeze({
      componentId: 'market-streams',
      group: 'binance',
      status: 'operational',
      detail: 'stale recovery evidence',
      observedAt: event.data.observedAt - 1,
    }));
    assert.equal(router.ingest(regressedRecovery).disposition, 'IGNORED');
    assert.equal(router.readProjection().incidents[0].recoveryProof.state, 'PENDING');
    const ignoredRecovery = ledger.readProductIncidentRoutingBySourceEventId(regressedRecovery.id);
    assert.equal(ignoredRecovery.kind, 'product.incident.source_ignored');
    assert.equal(ignoredRecovery.data.operation, 'IGNORE_LATE');
    const stillLateAlert = ledger.logEvent('connection_alert', null, Object.freeze({
      componentId: 'market-streams',
      group: 'binance',
      status: 'outage',
      detail: 'still below the durable effective source high-water',
      observedAt: event.data.observedAt - 1,
    }));
    assert.equal(router.ingest(stillLateAlert).disposition, 'IGNORED');
    assert.equal(ledger.readProductIncidentRoutingBySourceEventId(stillLateAlert.id).data.operation,
      'IGNORE_LATE');
    assert.equal(router.readProjection().incidents[0].count, 1);

    const unbootstrapped = createProductIncidentRouter(persistence(ledger));
    assert.deepEqual(unbootstrapped.readProjection(), {
      availability: {
        state: 'NOT_CONFIGURED',
        truthLabel: 'NOT_CONFIGURED',
        blocker: 'INCIDENT_ROUTER_BOOTSTRAP_REQUIRED',
      },
      incidents: [],
    });
    unbootstrapped.bootstrap(new Array(501).fill(event));
    assert.equal(unbootstrapped.readProjection().availability.blocker,
      'INCIDENT_ROUTER_BOOTSTRAP_PAGE_BOUND_EXCEEDED');

    const routedIncidentId = router.readProjection().incidents[0].incidentId;
    ledger.db.prepare('DELETE FROM product_incidents WHERE incident_id = ?').run(routedIncidentId);
    assert.throws(() => router.ingest(event), /no exact durable incident or rotation readback/,
      'a self-consistent route event without its incident row cannot suppress the source alert');
    const fabricatedRecovery = Object.freeze({
      id: 9_001,
      ts: event.ts,
      kind: 'connection_recovered',
      symbol: null,
      data: Object.freeze({
        componentId: 'market-streams',
        group: 'binance',
        status: 'operational',
        detail: 'fabricated recovery',
        observedAt: event.data.observedAt + 2,
      }),
    });
    assert.throws(() => router.ingest(fabricatedRecovery), /not exact durable Ledger truth/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 recovery without a matching active episode is ignored without fabricated proof', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const recovered = source(ledger, 'connection_recovered', 'operational');
    let router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));
    const count = ledger.countEvents();
    assert.deepEqual(router.ingest(recovered), {
      disposition: 'IGNORED', incidentId: null, sourceEventId: recovered.id,
    });
    assert.equal(ledger.countEvents(), count + 1, 'ignored recovery receives one immutable disposition');
    assert.deepEqual(router.readProjection().incidents, []);
    assert.equal(router.ingest(recovered).disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(ledger.countEvents(), count + 1);

    const laterAlert = source(ledger, 'connection_alert', 'degraded', 'later real episode');
    assert.equal(router.ingest(laterAlert).disposition, 'OPENED');
    assert.equal(router.readProjection().incidents[0].state, 'OPEN');
    ledger.close();

    ledger = new Ledger(dataDir);
    router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(ledger.readProductIncidentSourceEvents(0, 500));
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');
    assert.equal(router.readProjection().incidents.length, 1);
    assert.equal(router.readProjection().incidents[0].state, 'OPEN',
      'restart cannot time-travel an earlier unmatched recovery into a later episode');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 rejects forged source-route replay and fails closed before namespace truncation', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const event = source(ledger, 'connection_alert', 'outage', 'rendering stopped');
    ledger.logEvent('product.incident.opened', null, Object.freeze({
      schema: 'cosmos.product-incident-route.v1',
      operation: 'OPEN',
      sourceEventId: event.id,
      sourceEventKind: event.kind,
      sourceGroup: 'forged-group',
      sourceStatus: event.data.status,
      sourceDetail: event.data.detail,
      rootComponentId: event.data.componentId,
    }));
    const router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));
    assert.throws(() => router.ingest(event), /source route readback is invalid/);
    assert.equal(ledger.countProductIncidentsByFingerprintPrefix('incident.connection_unhealthy.'), 0);

    const capacitySource = Object.freeze({
      id: 9001,
      ts: event.ts,
      kind: 'connection_alert',
      symbol: null,
      data: Object.freeze({
        componentId: 'market-streams',
        group: 'binance',
        status: 'outage',
        detail: 'bounded namespace is full',
        observedAt: event.data.observedAt,
      }),
    });
    const overCapacity = createProductIncidentRouter(Object.freeze({
      readProductIncident: () => null,
      readProductIncidentSourceEvent: (sourceEventId) => sourceEventId === capacitySource.id ? capacitySource : null,
      readProductIncidentsByFingerprintPrefix: () => Object.freeze([]),
      countProductIncidentsByFingerprintPrefix: () => 201,
      readProductIncidentRoutingBySourceEventId: () => null,
      readProductIncidentRoutingByReceiptEventId: () => null,
      readLatestProductIncidentSourceDisposition: () => null,
      readPreviousProductIncidentSourceDisposition: () => null,
      readPreviousProductIncidentRoutedDisposition: () => null,
      readProductIncidentAcknowledgementByIncidentId: () => null,
      readProductIncidentOpeningRoutingByIncidentId: () => null,
      readProductIncidentRotationByIncidentId: () => null,
      readOldestResolvedProductIncidentByFingerprintPrefix: () => null,
      compareAndTransitionProductIncident: () => { throw new Error('must not mutate'); },
      compareAndRotateResolvedProductIncident: () => { throw new Error('must not rotate'); },
      recordProductIncidentSourceDisposition: () => { throw new Error('must not record'); },
      advanceProductIncidentRouterCheckpoint: () => { throw new Error('must not checkpoint'); },
    }));
    overCapacity.bootstrap(Object.freeze([]));
    assert.deepEqual(overCapacity.readProjection(), {
      availability: {
        state: 'UNAVAILABLE',
        truthLabel: 'UNAVAILABLE',
        blocker: 'INCIDENT_ROUTER_CAPACITY_EXCEEDED',
      },
      incidents: [],
    });
    assert.throws(() => overCapacity.ingest(capacitySource), /capacity is exceeded/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 routes more than ten thousand sources through an indexed checkpoint and bounded restart suffix', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));
    const queryPlan = ledger.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM events
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        )
        AND CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END = ?
      ORDER BY id ASC LIMIT 2
    `).all(1).map((row) => row.detail).join('\n');
    assert.match(queryPlan, /idx_events_product_incident_disposition_source_event/,
      'source-event route lookup must use the bounded expression index');

    const startedAt = performance.now();
    for (let index = 0; index < 10_001; index += 1) {
      const event = ledger.logEvent('connection_alert', null, Object.freeze({
        componentId: 'market-streams',
        group: 'binance',
        status: 'degraded',
        detail: 'bounded alert flood',
        observedAt: 1_700_100_000_000 + index,
      }));
      assert.equal(router.ingest(event).disposition, index === 0 ? 'OPENED' : 'GROUPED');
    }
    const populationMs = performance.now() - startedAt;
    assert.ok(populationMs < 60_000,
      `10,001-source routing must stay bounded; observed ${Math.round(populationMs)}ms`);
    assert.equal(ledger.countEvents(), 20_002);
    assert.deepEqual({
      processedCount: ledger.readProductIncidentRouterCheckpoint().processedCount,
      incidentCount: router.readProjection().incidents[0].count,
    }, { processedCount: 10_001, incidentCount: 10_001 });

    ledger.close();
    ledger = new Ledger(dataDir);
    const suffix = ledger.logEvent('connection_alert', null, Object.freeze({
      componentId: 'market-streams',
      group: 'binance',
      status: 'outage',
      detail: 'single restart suffix',
      observedAt: 1_700_100_010_001,
    }));
    const restartPage = ledger.readProductIncidentRouterBootstrapPage(500);
    assert.deepEqual(restartPage.map((event) => event.id), [suffix.id]);
    router = createProductIncidentRouter(persistence(ledger));
    router.beginBootstrap();
    assert.equal(router.bootstrapPage(restartPage), true);
    router.completeBootstrap();
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');
    assert.equal(router.readProjection().incidents[0].count, 10_002);
    assert.equal(ledger.readProductIncidentRouterCheckpoint().processedCount, 10_002);
    assert.equal(ledger.countEvents(), 20_004);

    ledger.close();
    ledger = new Ledger(dataDir);
    assert.deepEqual(ledger.readProductIncidentRouterBootstrapPage(500), []);
    assert.equal(ledger.countEvents(), 20_004, 'restart cannot duplicate source dispositions');
    router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');

    const checkpointKey = 'product.incident.router.checkpoint.v1';
    const exactCheckpoint = ledger.getConfigValue(checkpointKey);
    ledger.setConfigValue(checkpointKey, '{"schema":"forged"}');
    const blockedSource = ledger.logEvent('connection_alert', null, Object.freeze({
      componentId: 'market-streams',
      group: 'binance',
      status: 'outage',
      detail: 'must roll back on checkpoint tamper',
      observedAt: 1_700_100_010_002,
    }));
    const beforeBlockedRouteCount = ledger.countEvents('product.incident.grouped');
    assert.throws(() => router.ingest(blockedSource), /checkpoint is invalid/);
    assert.equal(ledger.countEvents('product.incident.grouped'), beforeBlockedRouteCount,
      'checkpoint failure rolls back the incident transition and route receipt atomically');
    assert.equal(ledger.readProductIncidentRoutingBySourceEventId(blockedSource.id), null);
    ledger.setConfigValue(checkpointKey, exactCheckpoint);
    assert.equal(router.ingest(blockedSource).disposition, 'GROUPED');

    const highWater = ledger.readProductIncidentRouterCheckpoint();
    assert.throws(() => ledger.db.prepare(`
      DELETE FROM product_incident_source_dispositions WHERE source_event_id = ?
    `).run(highWater.sourceEventId), /checkpoint history is immutable/);
    ledger.db.exec('DROP TRIGGER product_incident_source_dispositions_no_delete');
    ledger.db.prepare(`
      DELETE FROM product_incident_source_dispositions WHERE source_event_id = ?
    `).run(highWater.sourceEventId);
    assert.throws(() => ledger.readProductIncidentRouterBootstrapPage(500),
      /checkpoint mapping is invalid/,
      'a missing high-water mapping fails closed instead of replaying lifetime history');
  } finally {
    try { ledger.close(); } catch { /* already closed */ }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 rotates only the oldest exact resolved episode at the 200-item bound', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(Object.freeze([]));
    let oldestIncidentId = null;
    for (let index = 0; index < 200; index += 1) {
      const alert = source(ledger, 'connection_alert', 'outage', `episode ${index} outage`);
      const opened = router.ingest(alert);
      assert.equal(opened.disposition, 'OPENED');
      if (index === 0) oldestIncidentId = opened.incidentId;
      const recovery = source(ledger, 'connection_recovered', 'operational', `episode ${index} recovered`);
      assert.equal(router.ingest(recovery).disposition, 'RESOLVED');
    }
    assert.equal(router.readProjection().incidents.length, 200);
    const oldest = ledger.readProductIncident(oldestIncidentId);
    const opening = ledger.readProductIncidentOpeningRoutingByIncidentId(oldestIncidentId);
    withoutAppendOnlyTriggers(ledger.db, () => {
      assert.throws(() => ledger.db.prepare(`
        UPDATE events SET data = json_set(data, '$.eventCount', 999) WHERE id = ?
      `).run(opening.id), /checkpoint evidence is immutable/,
        'an opening route cannot be corrupted before rotation');
    });

    ledger.db.prepare(`
      UPDATE product_incidents SET event_count = event_count + 1 WHERE incident_id = ?
    `).run(oldestIncidentId);
    const nextAlert = source(ledger, 'connection_alert', 'outage', 'episode 200 outage');
    assert.throws(() => router.ingest(nextAlert),
      /audit does not match durable projection|audit is invalid|audit relationship is invalid/);
    assert.equal(ledger.countEvents('product.incident.rotated'), 0,
      'a corrupted candidate cannot be rotated');
    assert.equal(ledger.readProductIncidentRoutingBySourceEventId(nextAlert.id), null);
    ledger.db.prepare(`
      UPDATE product_incidents SET event_count = ? WHERE incident_id = ?
    `).run(oldest.eventCount, oldestIncidentId);
    assert.equal(router.ingest(nextAlert).disposition, 'OPENED');
    assert.equal(router.readProjection().incidents.length, 200);
    assert.equal(ledger.readProductIncident(oldestIncidentId), null);
    const rotation = ledger.readProductIncidentRotationByIncidentId(oldestIncidentId);
    assert.equal(rotation.kind, 'product.incident.rotated');
    assert.equal(rotation.data.snapshot.openingRoutingReceiptEventId, opening.id);
    assert.equal(ledger.countEvents('product.incident.rotated'), 1);

    const eventCount = ledger.countEvents();
    ledger.close();
    ledger = new Ledger(dataDir);
    router = createProductIncidentRouter(persistence(ledger));
    router.bootstrap(ledger.readProductIncidentRouterBootstrapPage(500));
    assert.equal(router.readProjection().availability.state, 'AVAILABLE');
    assert.equal(router.readProjection().incidents.length, 200);
    assert.equal(ledger.countEvents(), eventCount);
  } finally {
    try { ledger.close(); } catch { /* already closed */ }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('I00-050 Watchman cannot claim a live failure route while the canonical incident owner is unavailable', () => {
  const sourceText = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const start = sourceText.indexOf("id: 'alert-routing'");
  const end = sourceText.indexOf('\n    },', start);
  assert.ok(start >= 0 && end > start, 'alert-routing Watchman projection is missing');
  const projection = sourceText.slice(start, end);
  assert.match(projection,
    /status: notificationRouting\.destinations\.inApp\.available \? 'operational' : 'outage'/);
  assert.match(projection, /Canonical in-app incident route unavailable/);
  assert.match(projection,
    /value: notificationRouting\.destinations\.inApp\.available[\s\S]*'WIRED_LOCAL'[\s\S]*\.state/);
  assert.doesNotMatch(projection, /status:\s*'operational'|value:\s*'In-App Live'/);
});
