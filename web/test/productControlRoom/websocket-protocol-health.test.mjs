import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_WEB_SOCKET_PROTOCOL_HEALTH,
  WEB_SOCKET_PROTOCOL_CLOSE_CODE,
  WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD,
  decodeWebSocketProtocolEnvelope,
  reduceWebSocketProtocolHealth,
} from '../../src/lib/webSocketProtocolHealth.ts';

test('protocol failures degrade immediately, stay bounded, and require reconnect at threshold', () => {
  assert.equal(WEB_SOCKET_PROTOCOL_CLOSE_CODE, 4_002);
  assert.equal(WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD, 3);
  assert.deepEqual(INITIAL_WEB_SOCKET_PROTOCOL_HEALTH, {
    status: 'CURRENT',
    failureCount: 0,
    reconnectRequired: false,
  });

  const first = reduceWebSocketProtocolHealth(INITIAL_WEB_SOCKET_PROTOCOL_HEALTH, 'INVALID_ENVELOPE');
  assert.deepEqual(first, {
    status: 'DEGRADED',
    failureCount: 1,
    reconnectRequired: false,
  });
  assert.equal(Object.isFrozen(first), true);

  const second = reduceWebSocketProtocolHealth(first, 'INVALID_ENVELOPE');
  assert.deepEqual(second, {
    status: 'DEGRADED',
    failureCount: 2,
    reconnectRequired: false,
  });

  const threshold = reduceWebSocketProtocolHealth(second, 'INVALID_ENVELOPE');
  assert.deepEqual(threshold, {
    status: 'DEGRADED',
    failureCount: 3,
    reconnectRequired: true,
  });

  const bounded = Array.from({ length: 50 }).reduce(
    (current) => reduceWebSocketProtocolHealth(current, 'INVALID_ENVELOPE'),
    threshold,
  );
  assert.deepEqual(bounded, threshold);
});

test('valid traffic cannot erase protocol-failure evidence on the same socket', () => {
  const degraded = reduceWebSocketProtocolHealth(
    INITIAL_WEB_SOCKET_PROTOCOL_HEALTH,
    'INVALID_ENVELOPE',
  );
  const retained = reduceWebSocketProtocolHealth(degraded, 'VALID_ENVELOPE');
  assert.equal(retained, degraded);

  const second = reduceWebSocketProtocolHealth(retained, 'INVALID_ENVELOPE');
  const stillDegraded = reduceWebSocketProtocolHealth(second, 'VALID_ENVELOPE');
  const threshold = reduceWebSocketProtocolHealth(stillDegraded, 'INVALID_ENVELOPE');
  assert.equal(threshold.reconnectRequired, true);
  assert.equal(threshold.failureCount, WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD);
});

test('decoder rejects non-text, invalid JSON, unknown envelopes, and unbounded payloads', () => {
  const known = (value) => value !== null
    && typeof value === 'object'
    && value.type === 'canonical-supervisor-delta';

  assert.deepEqual(decodeWebSocketProtocolEnvelope(null, known), { ok: false, value: null });
  assert.deepEqual(decodeWebSocketProtocolEnvelope('{', known), { ok: false, value: null });
  assert.deepEqual(
    decodeWebSocketProtocolEnvelope(JSON.stringify({ type: 'unknown' }), known),
    { ok: false, value: null },
  );
  assert.deepEqual(
    decodeWebSocketProtocolEnvelope(JSON.stringify({
      type: 'canonical-supervisor-delta',
      padding: 'x'.repeat(1_048_576),
    }), known),
    { ok: false, value: null },
  );
  assert.deepEqual(
    decodeWebSocketProtocolEnvelope(JSON.stringify({ type: 'canonical-supervisor-delta' }), () => {
      throw new Error('validator failed');
    }),
    { ok: false, value: null },
  );
});

test('decoder returns a frozen success only after the known-envelope validator accepts', () => {
  const decoded = decodeWebSocketProtocolEnvelope(
    JSON.stringify({ type: 'canonical-supervisor-delta', payload: { revision: 'r1' } }),
    (value) => value !== null
      && typeof value === 'object'
      && value.type === 'canonical-supervisor-delta',
  );
  assert.deepEqual(decoded, {
    ok: true,
    value: { type: 'canonical-supervisor-delta', payload: { revision: 'r1' } },
  });
  assert.equal(Object.isFrozen(decoded), true);
});

test('store degrades visible socket health and closes the connection at the bounded threshold', async () => {
  // TEST EDITED TO ACCOMMODATE A REFACTOR. The Watchdog page was rebuilt from
  // one module into a route mount plus fourteen owned files; the browser socket
  // projection moved to src/pages/watchdog/ObserverEvidence.tsx, which is the
  // page's self-observation section. The assertion below keeps its substance —
  // the observatory still renders the socket state keyed on the store's
  // `connected`, and its truthy branch still never claims LIVE — and adds the
  // never-claim-LIVE check explicitly instead of leaving it implicit in a
  // literal.
  const [source, header, watchdog] = await Promise.all([
    readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/watchdog/ObserverEvidence.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /decodeWebSocketProtocolEnvelope\(msg\.data, isKnownWebSocketEnvelope\)/);
  assert.match(source, /applyProtocolObservation\('INVALID_ENVELOPE'\)/);
  assert.match(source, /setConnected\(false\)/);
  assert.match(source, /degraded\.reconnectRequired/);
  assert.match(source, /ws\.close\(WEB_SOCKET_PROTOCOL_CLOSE_CODE, WEB_SOCKET_PROTOCOL_CLOSE_REASON\)/);
  assert.match(source, /applyProtocolObservation\('VALID_ENVELOPE'\)/);
  assert.doesNotMatch(source, /catch\s*\{\s*\/\/ ignore\s*\}/);
  assert.match(header, /!connected \? \{ sev: 'invest', name: 'Cockpit socket offline'/);
  // The retired floating launcher owned the browser socket projection; the
  // Watchdog observatory now renders it, and still never claims LIVE offline.
  assert.match(watchdog, /socketConnected \? 'connected' : 'not connected'/);
  assert.match(watchdog, /SOCKET_NOT_CONNECTED/);
  // The store initialises `connected` to false, so an unproven socket must read
  // as not connected. Nothing on this surface may spell the truthy branch LIVE,
  // READY or HEALTHY — the words the i00 route gate matches.
  assert.doesNotMatch(watchdog, /socketConnected \?[^:}]*'(?:SOCKET )?(?:LIVE|READY|HEALTHY)'/);
});
