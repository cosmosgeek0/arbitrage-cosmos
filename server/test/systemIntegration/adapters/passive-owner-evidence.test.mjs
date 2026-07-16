import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  MACHINE_GRAPH_ROLES,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import { ASSURANCE_COCKPIT_SECTION_IDS } from '../../../dist/productAssurance/cockpit/viewModel.js';
import {
  PASSIVE_OWNER_EVIDENCE_CORRELATION_ID,
  PASSIVE_OWNER_EVIDENCE_SCHEMA,
  createPassiveOwnerEvidenceReadPort,
} from '../../../dist/systemIntegration/adapters/passiveOwnerEvidence.js';
import { validateSystemTraceEvent } from '../../../dist/systemIntegration/contracts/validation.js';
import { buildSystemSupervisorProjection } from '../../../dist/systemIntegration/supervisor/projection.js';
import { projectionInput } from '../supervisor/fixtures.mjs';

const NOW = 1_900_000_100_000;

test('publishes one deterministic deeply frozen unavailable-owner snapshot', () => {
  const leftPort = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW });
  const rightPort = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW });
  const left = leftPort.readPassiveOwnerEvidence();
  const right = rightPort.readPassiveOwnerEvidence();

  assert.deepEqual(left, right);
  assert.equal(left.schema, PASSIVE_OWNER_EVIDENCE_SCHEMA);
  assert.equal(left.version, 1);
  assert.equal(left.evaluatedAtMs, NOW);
  assert.match(left.projectionRevision, /^passive_owner_evidence_[a-f0-9]{32}$/u);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.l13.roles), true);
  assert.equal(Object.isFrozen(left.l13.metrics[0]), true);
  assert.equal(Object.isFrozen(left.productAssurance.sections), true);
  assert.strictEqual(leftPort.readPassiveOwnerEvidence(), leftPort.readPassiveOwnerEvidence());
  assert.strictEqual(leftPort.readTraceEvents(), leftPort.readTraceEvents());
  assert.deepEqual(Object.keys(leftPort).sort(), ['readPassiveOwnerEvidence', 'readTraceEvents']);
});

test('keeps L12 private truth owner-gated, quantities unknown, and cold start halted', () => {
  const l12 = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW })
    .readPassiveOwnerEvidence().l12;

  assert.equal(l12.wiringState, 'NOT_CONFIGURED');
  assert.equal(l12.truthLabel, 'UNAVAILABLE');
  assert.equal(l12.completeness, 'UNKNOWN');
  assert.equal(l12.privateTruthState, 'OWNER_GATED');
  assert.equal(l12.coldStartPosture, 'HALTED');
  assert.equal(l12.effectiveEntryMode, 'BLOCKED');
  assert.equal(l12.subject, null);
  assert.equal(l12.accountingScopeId, null);
  assert.equal(l12.capitalExposed, null);
  assert.equal(l12.syntheticInputAccepted, false);
  assert.equal(l12.authorityGranted, false);
  assert.equal(l12.controlAuthority, 'NONE_RECORD_ONLY');
  assert.equal(l12.readinessAuthority, 'NONE_RECORD_ONLY');
  assert.equal(l12.externalActionAuthorization, 'NONE');
  assert.equal(Object.values(l12).includes('LIVE_PUBLIC'), false);
});

test('keeps L13 roles unavailable while preserving owner-gated external and private seams', () => {
  const l13 = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW })
    .readPassiveOwnerEvidence().l13;
  const ownerGated = l13.roles
    .filter((role) => role.wiringState === 'OWNER_GATED')
    .map((role) => role.role);

  assert.deepEqual(l13.roles.map((role) => role.role), MACHINE_GRAPH_ROLES);
  assert.deepEqual(ownerGated, [
    'SECRETS_BOUNDARY',
    'SPOT_PRIVATE_STREAM',
    'USD_M_PRIVATE_STREAM',
    'MARGIN_PRIVATE_STREAM',
    'ACCOUNT_TRUTH',
    'EC2_PROCESS',
    'CLOUDFLARE_TUNNEL_ACCESS',
    'WATCHDOG_ALARMS',
  ]);
  assert.equal(l13.roles.every((role) => role.evidenceState === 'UNAVAILABLE'), true);
  assert.equal(l13.roles.every((role) => role.completeness === 'UNKNOWN'), true);
  assert.equal(l13.graphState, 'UNKNOWN');
  assert.equal(l13.topologyAuthority, 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY');
  assert.equal(l13.rootCauseAuthority, 'NONE_RECORD_ONLY');
  assert.equal(l13.readinessAuthority, 'NONE_RECORD_ONLY');
  assert.equal(l13.controlAuthority, 'NONE_RECORD_ONLY');
  assert.equal(Object.hasOwn(l13, 'edges'), false);
  assert.equal(Object.hasOwn(l13, 'topology'), false);
  assert.equal(Object.hasOwn(l13, 'controls'), false);
});

test('retains L13 metric window/reset unknowns and Foundation Observability alarm ownership', () => {
  const l13 = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW })
    .readPassiveOwnerEvidence().l13;

  assert.deepEqual(l13.metrics.map((metric) => metric.metric), MACHINE_GRAPH_METRICS);
  assert.equal(l13.metrics.length, 36);
  assert.equal(l13.metrics.every((metric) => metric.owner === 'FOUNDATION_OBSERVABILITY'), true);
  assert.equal(l13.metrics.every((metric) => metric.status === 'UNAVAILABLE' && metric.value === null), true);
  for (const metric of l13.metrics) {
    const counter = MACHINE_GRAPH_METRIC_INSTRUMENTS[metric.metric] === 'COUNTER';
    assert.equal(metric.window, null);
    assert.equal(metric.windowContinuity, counter ? 'UNKNOWN' : null);
    assert.equal(metric.resetState, counter ? 'UNKNOWN' : null);
    assert.deepEqual(metric.reasonCodes, ['FOUNDATION_OBSERVABILITY_METRIC_NOT_CONFIGURED']);
  }

  assert.deepEqual(l13.alarms.map((alarm) => alarm.alarm), MACHINE_GRAPH_ALARMS);
  assert.equal(l13.alarms.length, 13);
  assert.equal(l13.alarms.every((alarm) => alarm.owner === 'FOUNDATION_OBSERVABILITY'), true);
  assert.equal(l13.alarms.every((alarm) => alarm.state === 'UNAVAILABLE'), true);
  assert.equal(l13.alarms.every((alarm) => alarm.haltRecommendation === null), true);
  assert.equal(l13.alarms.every((alarm) => alarm.automaticAction === 'NONE'), true);
  assert.equal(l13.alarms.every((alarm) => !alarm.canLiquidate && !alarm.canMutateCapital), true);
});

test('keeps every Product Assurance cockpit section unknown and control-free', () => {
  const assurance = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW })
    .readPassiveOwnerEvidence().productAssurance;

  assert.deepEqual(assurance.sections.map((section) => section.sectionId), ASSURANCE_COCKPIT_SECTION_IDS);
  assert.equal(assurance.sections.length, 11);
  assert.equal(assurance.sections.every((section) => section.wiringState === 'NOT_CONFIGURED'), true);
  assert.equal(assurance.sections.every((section) => section.truthLabel === 'UNKNOWN'), true);
  assert.equal(assurance.sections.every((section) => section.canonicalVerdict === 'UNKNOWN'), true);
  assert.equal(assurance.sections.every((section) => section.operatorState === 'NOT_CONFIGURED'), true);
  assert.equal(assurance.sections.every((section) => section.projection === null), true);
  assert.equal(assurance.sections.every((section) => section.controlIds.length === 0), true);
  assert.equal(assurance.controlIds.length, 0);
  assert.equal(assurance.productReadinessComputed, false);
  assert.equal(assurance.authorityGranted, false);
  assert.equal(assurance.executionAuthorityGranted, false);
  assert.equal(assurance.moneyAuthorityGranted, false);
});

test('feeds only non-green evidence through the existing canonical supervisor trace seam', () => {
  const port = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: NOW });
  const events = port.readTraceEvents();

  assert.equal(events.length, 3);
  assert.equal(events.every((event) => event.correlationId === PASSIVE_OWNER_EVIDENCE_CORRELATION_ID), true);
  assert.equal(events.every((event) => event.releaseStatuses.includes('NOT_CONFIGURED')), true);
  assert.equal(events.every((event) => ['UNAVAILABLE', 'UNKNOWN'].includes(event.truthLabel)), true);
  assert.equal(events.every((event) => event.machinePhase === null), true);
  assert.equal(events.every((event) => event.failure === null), true);
  assert.equal(events.every((event) => validateSystemTraceEvent(event).length === 0), true);

  const projected = buildSystemSupervisorProjection(projectionInput({
    nowMs: NOW,
    traceEvents: events,
    componentOverrides: {
      'q-inference': { owner: 'Q_INFERENCE' },
    },
  }));
  assert.equal(projected.ok, true);
  const entry = projected.value.traceIndex.entries.find(
    (candidate) => candidate.correlationId === PASSIVE_OWNER_EVIDENCE_CORRELATION_ID,
  );
  assert.ok(entry);
  // Canonical trace normalization maps every NOT_CONFIGURED release to the
  // UNAVAILABLE truth label while retaining the more specific UNKNOWN facts
  // in bounded owner references.
  assert.deepEqual(entry.truthLabels, ['UNAVAILABLE']);
  assert.equal(entry.snapshot.events.some((event) => (
    event.referenceIds.includes('coverageState=UNKNOWN')
  )), true);
  assert.equal(entry.snapshot.events.some((event) => event.truthLabel === 'LIVE_PUBLIC'), false);
  assert.equal(projected.value.recentCorrelatedDecisions
    .filter((event) => event.correlationId === PASSIVE_OWNER_EVIDENCE_CORRELATION_ID)
    .some((event) => event.truthLabel === 'LIVE_PUBLIC'), false);
});

test('rejects every synthetic promotion path and imports no fixture builder', async () => {
  assert.throws(
    () => createPassiveOwnerEvidenceReadPort({
      evaluatedAtMs: NOW,
      l12Snapshot: { truthClass: 'SYNTHETIC_ONLY' },
    }),
    /exact closed schema/u,
  );
  assert.throws(
    () => createPassiveOwnerEvidenceReadPort({
      evaluatedAtMs: NOW,
      machineGraphSnapshot: { truthClass: 'SYNTHETIC_ONLY_UNWIRED' },
    }),
    /exact closed schema/u,
  );
  assert.throws(
    () => createPassiveOwnerEvidenceReadPort({
      evaluatedAtMs: NOW,
      assuranceFixture: { truthLabel: 'SYNTHETIC_ONLY' },
    }),
    /exact closed schema/u,
  );
  assert.throws(
    () => createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: Number.NaN }),
    /valid injected UTC milliseconds/u,
  );
  const hidden = { evaluatedAtMs: NOW };
  Object.defineProperty(hidden, 'fixture', { value: {}, enumerable: false });
  assert.throws(
    () => createPassiveOwnerEvidenceReadPort(hidden),
    /exact closed schema/u,
  );

  const source = await readFile(
    new URL('../../../src/systemIntegration/adapters/passiveOwnerEvidence.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:fixtures|test)\//u);
  assert.doesNotMatch(source, /LIVE_EXECUTION|SIGNED_REQUEST|privateKey|apiKey/u);
});
