import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeObservedEvidence } from '../../../dist/foundation/reconciliation/index.js';
import { projectObservedOrderFocus } from '../../../dist/systemIntegration/adapters/index.js';

const NOW = 1_800_000_000_000;

function metadata(overrides = {}) {
  return {
    sourceId: 'foundation.reconciliation.open-orders',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    coverageStartMs: null,
    coverageEndMs: null,
    ...overrides,
  };
}

function order(symbol, status, index, overrides = {}) {
  return {
    venue: 'BINANCE_SPOT',
    symbol,
    clientOrderId: `client-${index}`,
    venueOrderId: `venue-${index}`,
    side: 'BUY',
    originalQuantity: 1,
    cumulativeFilledQuantity: status === 'FILLED' ? 1 : 0,
    status,
    reduceOnly: null,
    updatedAtMs: NOW - 100,
    ...overrides,
  };
}

function evidence(records, metadataOverrides = {}) {
  return {
    orders: { metadata: metadata(metadataOverrides), records },
    fills: { metadata: metadata({ sourceId: 'foundation.reconciliation.fills' }), records: [] },
    positions: { metadata: metadata({ sourceId: 'foundation.reconciliation.positions' }), records: [] },
  };
}

test('normalized owner projection exposes only active symbols and a known empty cut stays exact', () => {
  const normalized = normalizeObservedEvidence(evidence([
    order('ETHUSDT', 'PARTIALLY_FILLED', 2),
    order('BTCUSDT', 'NEW', 1),
    order('SOLUSDT', 'FILLED', 3),
  ]), NOW);
  const projected = projectObservedOrderFocus(normalized);
  assert.equal(projected.state, 'AVAILABLE');
  assert.deepEqual(projected.openSymbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(projected.observedAtMs, NOW - 100);
  assert.equal(projected.validUntilMs, NOW + 900);
  assert.equal(JSON.stringify(projected).includes('client-'), false);
  assert.equal(JSON.stringify(projected).includes('venue-'), false);

  const knownEmpty = projectObservedOrderFocus(normalizeObservedEvidence(evidence([]), NOW));
  assert.equal(knownEmpty.state, 'AVAILABLE');
  assert.deepEqual(knownEmpty.openSymbols, []);
});

test('partial, stale, public, unknown-status, and conflicting truth can never clear orders', () => {
  const cases = [
    evidence([], { completeness: 'PARTIAL' }),
    evidence([], { sourceTimeMs: NOW - 2_000, receivedAtMs: NOW - 2_000, maxAgeMs: 1_000 }),
    evidence([], { authority: 'LIVE_PUBLIC' }),
    evidence([order('BTCUSDT', 'UNKNOWN', 1)]),
    evidence([
      order('BTCUSDT', 'NEW', 1),
      order('ETHUSDT', 'NEW', 2, { clientOrderId: 'client-1' }),
    ]),
  ];
  const reasonSets = cases.map((input) => {
    const projected = projectObservedOrderFocus(normalizeObservedEvidence(input, NOW));
    assert.equal(projected.state, 'UNAVAILABLE');
    assert.equal(projected.openSymbols, null);
    assert.equal(projected.validUntilMs, null);
    assert.ok(projected.reasonCodes.length > 0);
    return projected.reasonCodes;
  });
  assert.ok(reasonSets[0].includes('OPEN_ORDER_TRUTH_NOT_COMPLETE'));
  assert.ok(reasonSets[1].includes('OPEN_ORDER_TRUTH_STALE'));
  assert.ok(reasonSets[2].includes('OPEN_ORDER_PRIVATE_AUTHORITY_REQUIRED'));
  assert.ok(reasonSets[3].includes('OPEN_ORDER_STATUS_UNKNOWN'));
  assert.ok(reasonSets[4].includes('OPEN_ORDER_IDENTITY_CONFLICT'));
});
