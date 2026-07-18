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
