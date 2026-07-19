import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The root test runner has no root tsconfig, so its TSX loader uses the classic
// transform for shared house primitives (same accommodation as web/test/aiOps).
globalThis.React = React;

// Style imports are build-time concerns; resolve them to empty modules here.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.css')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: '' };
  },
});

const { createFixtureSession } = await import('../../src/lib/productIntegration/model.ts');
const { buildProductControlRoomFixture } = await import('../../src/features/productControlRoom/fixtureBinding.ts');
const { ProductControlRoom } = await import('../../src/features/productControlRoom/ProductControlRoom.tsx');

const NOW = 1_800_000_000_000;

test('dashboard ages are measured against the integrator clock, not the snapshot timestamp', () => {
  // The regression this pins: the binding passed nowMs={snapshot.evaluatedAtMs}
  // so every age rendered "0s ago" forever, making a wedged supervisor serving
  // its last snapshot indistinguishable from a live one.
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'age-clock', NOW));
  const html = renderToStaticMarkup(createElement(ProductControlRoom, {
    snapshot,
    busy: false,
    clock: () => snapshot.evaluatedAtMs + 120_000,
    onPreview: async () => { throw new Error('CONTROL_PREVIEW_UNUSED'); },
    onSubmit: async () => { throw new Error('CONTROL_SUBMIT_UNUSED'); },
  }));
  assert.match(html, /Evaluated <code>2m ago<\/code>/);
  assert.doesNotMatch(html, /Evaluated <code>0s ago<\/code>/);
});
