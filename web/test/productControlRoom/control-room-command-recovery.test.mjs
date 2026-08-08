import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.css')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: '' };
  },
});

const { createFixtureSession } = await import('../../src/lib/productIntegration/model.ts');
const { buildProductControlRoomFixture } = await import('../../src/features/productControlRoom/fixtureBinding.ts');
const {
  OWNER_COMMAND_SNAPSHOT_STALE_AFTER_MS,
  ProductControlRoom,
  projectOwnerCommandTruth,
} = await import('../../src/features/productControlRoom/ProductControlRoom.tsx');

const NOW = Date.parse('2026-08-01T00:00:00Z');
const unusedPreview = async () => { throw new Error('CONTROL_PREVIEW_UNUSED'); };
const unusedSubmit = async () => { throw new Error('CONTROL_SUBMIT_UNUSED'); };

test('owner command truth fails closed on stale, skewed, and unavailable evidence', () => {
  const current = buildProductControlRoomFixture(
    createFixtureSession('HEALTHY_OBSERVE', 'command-current', NOW),
  );
  const stale = buildProductControlRoomFixture(
    createFixtureSession('DEGRADED_STALE_SOURCES', 'command-stale', NOW),
  );
  const productionCurrent = {
    ...current,
    ownerView: { ...current.ownerView, dataFreshness: '4000ms max public-source age' },
    components: current.components.map((component) => (
      component.componentId === 'public-spot-source' || component.componentId === 'public-usdm-source'
        ? { ...component, freshnessState: 'FRESH', sourceAgeMs: 4_000 }
        : component
    )),
  };
  const productionStale = {
    ...productionCurrent,
    ownerView: { ...productionCurrent.ownerView, dataFreshness: '3600000ms max public-source age' },
  };

  assert.equal(projectOwnerCommandTruth(current, null, NOW), 'CURRENT');
  assert.equal(projectOwnerCommandTruth(stale, null, NOW), 'STALE');
  assert.equal(projectOwnerCommandTruth(productionCurrent, null, NOW), 'CURRENT');
  assert.equal(projectOwnerCommandTruth(productionStale, null, NOW), 'STALE');
  assert.equal(
    projectOwnerCommandTruth(current, null, NOW + OWNER_COMMAND_SNAPSHOT_STALE_AFTER_MS),
    'STALE',
  );
  assert.equal(projectOwnerCommandTruth(current, null, NOW - 5_001), 'UNAVAILABLE');
  assert.equal(projectOwnerCommandTruth(null, null, NOW), 'UNAVAILABLE');
  assert.equal(projectOwnerCommandTruth(null, current, NOW), 'STALE');
});

test('stale posture and continuity gaps disable commands while keeping preview labels honest', () => {
  const snapshot = buildProductControlRoomFixture(
    createFixtureSession('HEALTHY_OBSERVE', 'command-render', NOW),
  );
  const liveSnapshot = {
    ...snapshot,
    controls: [{ ...snapshot.controls[0], wiringState: 'WIRED_LIVE' }],
  };
  const currentHtml = renderToStaticMarkup(createElement(ProductControlRoom, {
    snapshot: liveSnapshot,
    busy: false,
    clock: () => NOW,
    allowFixtureControls: true,
    onPreview: unusedPreview,
    onSubmit: unusedSubmit,
  }));

  assert.match(currentHtml, /data-owner-command-truth="current"/u);
  assert.match(currentHtml, /<button[^>]*aria-disabled="false"[^>]*aria-label="Preview Safe Mode"/u);
  assert.match(currentHtml, />Preview Safe Mode<\/button>/u);

  const staleHtml = renderToStaticMarkup(createElement(ProductControlRoom, {
    snapshot: {
      ...liveSnapshot,
      ownerView: { ...liveSnapshot.ownerView, dataFreshness: '3600000ms max public-source age' },
    },
    busy: false,
    clock: () => NOW,
    allowFixtureControls: true,
    onPreview: unusedPreview,
    onSubmit: unusedSubmit,
  }));
  assert.match(staleHtml, /data-owner-command-truth="stale"/u);
  assert.match(staleHtml, /COMMAND_POSTURE_STALE/u);
  assert.match(staleHtml, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*aria-label="Preview Safe Mode"/u);

  const materialEvents = {
    ...snapshot.materialEvents,
    highWaterCursor: '91',
    nextCursor: '44',
    continuity: 'GAP',
    truncated: true,
    backfillRequired: true,
    hasMore: true,
    items: [],
  };
  const gapHtml = renderToStaticMarkup(createElement(ProductControlRoom, {
    snapshot: liveSnapshot,
    materialEvents,
    busy: false,
    clock: () => NOW,
    allowFixtureControls: true,
    onPreview: unusedPreview,
    onSubmit: unusedSubmit,
  }));
  assert.match(gapHtml, /COMMAND_CONTINUITY_NOT_PROVEN · MATERIAL_EVENT_CONTINUITY_GAP/u);
  assert.match(gapHtml, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*aria-label="Preview Safe Mode"/u);
});
