import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';
import {
  createFixtureSession,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import { ComponentOperationalHealthTable } from '../../src/pages/ComponentOperationalHealthTable.tsx';

globalThis.React = React;

const NOW = 1_800_000_000_000;

function snapshot() {
  return buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'mis-063', NOW));
}

test('MIS-063 Health renders canonical present and unavailable component truth as a semantic table', () => {
  const fixture = snapshot();
  const [first, ...rest] = fixture.components;
  const rich = Object.freeze({
    ...first,
    processingLagMs: 17,
    dataQualityState: 'DEGRADED',
    dataQualityInvalidCount: 2,
    dataQualityDuplicateCount: 1,
    dataQualityOutOfOrderCount: 0,
    dataQualitySequenceGapCount: 3,
    dataQualityObservedAtMs: NOW - 100,
    retryState: 'BACKING_OFF',
    retryAttempt: 2,
    retryCeiling: 9,
    backoffMs: 750,
    retryAtMs: NOW + 750,
    checkpointState: 'CURRENT',
    checkpointRevision: 'spot-cp-7',
    checkpointPersistedAtMs: NOW - 200,
    generation: 4,
    restartState: 'RESTARTED',
    restartCount: 3,
  });
  const components = Object.freeze([rich, ...rest]);
  const html = renderToStaticMarkup(React.createElement(ComponentOperationalHealthTable, { components }));

  assert.match(html, /role="table"/);
  assert.match(html, /aria-colcount="6"/);
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 6);
  assert.equal((html.match(/role="cell"/g) ?? []).length, components.length * 6);
  assert.match(html, /Heartbeat \/ Freshness/);
  assert.match(html, /17 ms Lag/);
  assert.match(html, /Invalid 2 · Duplicate 1 · Out Of Order 0 · Gaps 3/);
  assert.match(html, /Observed \d{2}:\d{2}:\d{2} UTC/);
  assert.match(html, /Attempt 2 \/ 9 · 750 ms backoff/);
  assert.match(html, /spot-cp-7/);
  assert.match(html, /Generation 4 · 3 Restarts/);
  assert.match(html, /UNAVAILABLE/);
  assert.match(html, /UNKNOWN/);
});

test('MIS-063 client boundary rejects invented operational values behind unavailable truth', () => {
  const fixture = snapshot();
  const components = fixture.components.map((component, index) => index === 0
    ? {
      ...component,
      dataQualityState: 'UNAVAILABLE',
      dataQualityInvalidCount: 1,
      retryAtMs: Number.MAX_VALUE,
    }
    : component);
  const errors = validateProductSupervisorEnvelope({ ...fixture, components });
  assert.ok(errors.includes('COMPONENT_DATA_QUALITY_UNKNOWN_CONFLICT'));
  assert.ok(errors.includes('COMPONENT_FIELD_INVALID:retryAtMs'));
});

test('MIS-063 client boundary rejects GOOD quality with all evidence missing', () => {
  const fixture = snapshot();
  const components = fixture.components.map((component, index) => index === 0
    ? {
      ...component,
      dataQualityState: 'GOOD',
      dataQualityInvalidCount: null,
      dataQualityDuplicateCount: null,
      dataQualityOutOfOrderCount: null,
      dataQualitySequenceGapCount: null,
    }
    : component);

  const errors = validateProductSupervisorEnvelope({ ...fixture, components });
  assert.ok(errors.includes('COMPONENT_DATA_QUALITY_GOOD_EVIDENCE_REQUIRED'));
});

test('MIS-063 client boundary rejects BACKING_OFF with all retry evidence missing', () => {
  const fixture = snapshot();
  const components = fixture.components.map((component, index) => index === 0
    ? {
      ...component,
      retryState: 'BACKING_OFF',
      retryAttempt: null,
      retryCeiling: null,
      backoffMs: null,
      retryAtMs: null,
      cooldownUntilMs: null,
    }
    : component);

  const errors = validateProductSupervisorEnvelope({ ...fixture, components });
  assert.ok(errors.includes('COMPONENT_RETRY_BACKOFF_EVIDENCE_REQUIRED'));
});

test('MIS-063 client retry boundary mirrors every canonical server state', () => {
  const valid = {
    IDLE: { retryState: 'IDLE', retryAttempt: 0, retryCeiling: 8, backoffMs: null, retryAtMs: null, cooldownUntilMs: null },
    RETRYING: { retryState: 'RETRYING', retryAttempt: 1, retryCeiling: 8, backoffMs: 0, retryAtMs: NOW, cooldownUntilMs: null },
    BACKING_OFF: { retryState: 'BACKING_OFF', retryAttempt: 2, retryCeiling: 8, backoffMs: 500, retryAtMs: NOW + 500, cooldownUntilMs: null },
    COOLDOWN: { retryState: 'COOLDOWN', retryAttempt: 3, retryCeiling: 8, backoffMs: 500, retryAtMs: NOW + 500, cooldownUntilMs: NOW + 1_000 },
    UNKNOWN: { retryState: 'UNKNOWN', retryAttempt: null, retryCeiling: null, backoffMs: null, retryAtMs: null, cooldownUntilMs: null },
    UNAVAILABLE: { retryState: 'UNAVAILABLE', retryAttempt: null, retryCeiling: null, backoffMs: null, retryAtMs: null, cooldownUntilMs: null },
  };
  for (const [state, retry] of Object.entries(valid)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...retry } : component);
    assert.equal(validateProductSupervisorEnvelope({ ...fixture, components }).length, 0, state);
  }
  const invalid = {
    IDLE: { ...valid.IDLE, retryAttempt: 1 },
    RETRYING: { ...valid.RETRYING, retryAttempt: null },
    BACKING_OFF: { ...valid.BACKING_OFF, cooldownUntilMs: NOW + 1_000 },
    COOLDOWN: { ...valid.COOLDOWN, cooldownUntilMs: null },
    UNKNOWN: { ...valid.UNKNOWN, retryAttempt: 0 },
    UNAVAILABLE: { ...valid.UNAVAILABLE, retryCeiling: 8 },
  };
  for (const [state, retry] of Object.entries(invalid)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...retry } : component);
    const errors = validateProductSupervisorEnvelope({ ...fixture, components });
    assert.ok(errors.some((error) => error.startsWith('COMPONENT_RETRY_')), state);
  }
});

test('MIS-063 client quality and checkpoint boundaries mirror every canonical server state', () => {
  const quality = {
    GOOD: { dataQualityState: 'GOOD', dataQualityInvalidCount: 0, dataQualityDuplicateCount: 0, dataQualityOutOfOrderCount: 0, dataQualitySequenceGapCount: 0, dataQualityObservedAtMs: NOW },
    DEGRADED: { dataQualityState: 'DEGRADED', dataQualityInvalidCount: 1, dataQualityDuplicateCount: 0, dataQualityOutOfOrderCount: 0, dataQualitySequenceGapCount: 0, dataQualityObservedAtMs: NOW },
    UNKNOWN: { dataQualityState: 'UNKNOWN', dataQualityInvalidCount: null, dataQualityDuplicateCount: null, dataQualityOutOfOrderCount: null, dataQualitySequenceGapCount: null, dataQualityObservedAtMs: null },
    UNAVAILABLE: { dataQualityState: 'UNAVAILABLE', dataQualityInvalidCount: null, dataQualityDuplicateCount: null, dataQualityOutOfOrderCount: null, dataQualitySequenceGapCount: null, dataQualityObservedAtMs: null },
  };
  for (const [state, dataQuality] of Object.entries(quality)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...dataQuality } : component);
    assert.equal(validateProductSupervisorEnvelope({ ...fixture, components }).length, 0, state);
  }
  const invalidQuality = {
    GOOD: { ...quality.GOOD, dataQualityObservedAtMs: null },
    DEGRADED: { ...quality.DEGRADED, dataQualityDuplicateCount: null },
    UNKNOWN: { ...quality.UNKNOWN, dataQualityObservedAtMs: NOW },
    UNAVAILABLE: { ...quality.UNAVAILABLE, dataQualityInvalidCount: 0 },
  };
  for (const [state, dataQuality] of Object.entries(invalidQuality)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...dataQuality } : component);
    const errors = validateProductSupervisorEnvelope({ ...fixture, components });
    assert.ok(errors.some((error) => error.startsWith('COMPONENT_DATA_QUALITY_')), state);
  }

  const checkpoint = {
    CURRENT: { checkpointState: 'CURRENT', checkpointRevision: 'cp-1', checkpointPersistedAtMs: NOW },
    DIRTY: { checkpointState: 'DIRTY', checkpointRevision: 'cp-1', checkpointPersistedAtMs: NOW },
    STALE: { checkpointState: 'STALE', checkpointRevision: 'cp-1', checkpointPersistedAtMs: NOW },
    MISSING: { checkpointState: 'MISSING', checkpointRevision: null, checkpointPersistedAtMs: null },
    UNKNOWN: { checkpointState: 'UNKNOWN', checkpointRevision: null, checkpointPersistedAtMs: null },
    UNAVAILABLE: { checkpointState: 'UNAVAILABLE', checkpointRevision: null, checkpointPersistedAtMs: null },
  };
  for (const [state, value] of Object.entries(checkpoint)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...value } : component);
    assert.equal(validateProductSupervisorEnvelope({ ...fixture, components }).length, 0, state);
  }
  for (const [state, value] of Object.entries(checkpoint)) {
    const invalid = ['CURRENT', 'DIRTY', 'STALE'].includes(state)
      ? { ...value, checkpointPersistedAtMs: null }
      : { ...value, checkpointRevision: 'invented' };
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...invalid } : component);
    const errors = validateProductSupervisorEnvelope({ ...fixture, components });
    assert.ok(errors.some((error) => error.startsWith('COMPONENT_CHECKPOINT_')), state);
  }
});

test('MIS-063 restart state requires exact evidence and consistent generation counters', () => {
  const valid = {
    NEVER_RESTARTED: { restartState: 'NEVER_RESTARTED', generation: 1, restartCount: 0, blockerCode: null },
    RESTARTED: { restartState: 'RESTARTED', generation: 2, restartCount: 1, blockerCode: null },
    RESTART_REQUIRED: { restartState: 'RESTART_REQUIRED', generation: 1, restartCount: 0, blockerCode: 'SOURCE_RESTART_REQUIRED' },
    UNKNOWN: { restartState: 'UNKNOWN', generation: 0, restartCount: 0, blockerCode: null },
  };
  for (const [state, restart] of Object.entries(valid)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...restart } : component);
    assert.equal(validateProductSupervisorEnvelope({ ...fixture, components }).length, 0, state);
  }
  const invalid = {
    NEVER_RESTARTED: { ...valid.NEVER_RESTARTED, restartCount: 1 },
    RESTARTED: { ...valid.RESTARTED, generation: 0 },
    RESTART_REQUIRED: { ...valid.RESTART_REQUIRED, blockerCode: 'OWNER_AUTHORIZATION_REQUIRED' },
    UNKNOWN: { ...valid.UNKNOWN, generation: 1 },
  };
  for (const [state, restart] of Object.entries(invalid)) {
    const fixture = snapshot();
    const components = fixture.components.map((component, index) => index === 0 ? { ...component, ...restart } : component);
    const errors = validateProductSupervisorEnvelope({ ...fixture, components });
    assert.ok(errors.some((error) => error.startsWith('COMPONENT_RESTART_')), state);
  }
});
