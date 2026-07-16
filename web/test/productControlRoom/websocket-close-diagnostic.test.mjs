import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  reduceTrustedWebSocketCloseDiagnostic,
  snapshotTrustedWebSocketCloseEvent,
  webSocketCloseDiagnosticAttributes,
} from '../../src/lib/webSocketCloseDiagnostic.ts';

class BrowserCloseEventFixture {
  constructor({
    code,
    reason,
    wasClean,
    isTrusted,
    type = 'close',
  }) {
    this.code = code;
    this.reason = reason;
    this.wasClean = wasClean;
    this.isTrusted = isTrusted;
    this.type = type;
  }
}

const originalCloseEvent = Object.getOwnPropertyDescriptor(globalThis, 'CloseEvent');
Object.defineProperty(globalThis, 'CloseEvent', {
  configurable: true,
  writable: true,
  value: BrowserCloseEventFixture,
});
test.after(() => {
  if (originalCloseEvent) Object.defineProperty(globalThis, 'CloseEvent', originalCloseEvent);
  else delete globalThis.CloseEvent;
});

test('trusted native close snapshot preserves exact 1012 truth and is immutable', () => {
  const event = new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
  });
  const diagnostic = snapshotTrustedWebSocketCloseEvent(event, 7);
  assert.deepEqual(diagnostic, {
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    reconnectGeneration: 7,
  });
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.deepEqual(webSocketCloseDiagnosticAttributes(diagnostic), {
    'data-i00-ws-close-status': 'OBSERVED',
    'data-i00-ws-close-code': '1012',
    'data-i00-ws-close-reason': 'service restart',
    'data-i00-ws-close-was-clean': 'true',
    'data-i00-ws-close-generation': '7',
  });
});

test('unavailable state omits every close claim instead of inventing a restart', () => {
  const attributes = webSocketCloseDiagnosticAttributes(null);
  assert.deepEqual(attributes, { 'data-i00-ws-close-status': 'UNAVAILABLE' });
  assert.equal(Object.isFrozen(attributes), true);
  assert.equal('data-i00-ws-close-code' in attributes, false);
  assert.equal('data-i00-ws-close-reason' in attributes, false);
  assert.equal('data-i00-ws-close-was-clean' in attributes, false);
  assert.equal('data-i00-ws-close-generation' in attributes, false);
});

test('script-created and lookalike close events cannot manufacture evidence', () => {
  const scriptCreated = new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: false,
  });
  assert.equal(snapshotTrustedWebSocketCloseEvent(scriptCreated, 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
    type: 'close',
  }, 1), null);
});

test('malformed or unbounded close observations fail closed', () => {
  const trusted = (patch = {}) => new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
    ...patch,
  });
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted({ code: 999 }), 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted({ code: 5_000 }), 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted({ reason: 'x'.repeat(124) }), 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted({ wasClean: 'true' }), 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted({ type: 'message' }), 1), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted(), 0), null);
  assert.equal(snapshotTrustedWebSocketCloseEvent(trusted(), 1_000_001), null);
});

test('an unopened retry cannot overwrite the last established socket close', () => {
  const restart = snapshotTrustedWebSocketCloseEvent(new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
  }), 7);
  const unopenedRetry = new CloseEvent({
    code: 1006,
    reason: '',
    wasClean: false,
    isTrusted: true,
  });

  assert.equal(reduceTrustedWebSocketCloseDiagnostic(null, unopenedRetry, 8, false), null);
  const retained = reduceTrustedWebSocketCloseDiagnostic(restart, unopenedRetry, 8, false);
  assert.equal(retained, restart);
  assert.deepEqual(retained, {
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    reconnectGeneration: 7,
  });
});

test('a later established socket close replaces prior restart truth and malformed truth clears it', () => {
  const restart = snapshotTrustedWebSocketCloseEvent(new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
  }), 7);
  const establishedFailure = new CloseEvent({
    code: 1006,
    reason: '',
    wasClean: false,
    isTrusted: true,
  });

  assert.deepEqual(reduceTrustedWebSocketCloseDiagnostic(restart, establishedFailure, 9, true), {
    code: 1006,
    reason: '',
    wasClean: false,
    reconnectGeneration: 9,
  });
  assert.deepEqual(reduceTrustedWebSocketCloseDiagnostic(null, new CloseEvent({
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    isTrusted: true,
  }), 10, true), {
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    reconnectGeneration: 10,
  });
  assert.equal(reduceTrustedWebSocketCloseDiagnostic(restart, { type: 'close' }, 9, true), null);
});

test('production store records the diagnostic only inside the guarded real onclose path', async () => {
  const source = await readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8');
  assert.match(source, /ws\.onclose = \(event\) => \{/);
  assert.equal(
    (source.match(/setWebSocketCloseDiagnostic\s*\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source.match(/reduceTrustedWebSocketCloseDiagnostic\(/g) ?? []).length,
    1,
  );
  assert.match(source, /let connectionEstablished = false;/);
  assert.match(source, /connectionEstablished = true;/);
  assert.match(source, /setWebSocketCloseDiagnostic\(\(current\) => reduceTrustedWebSocketCloseDiagnostic\(/);
  assert.match(source, /socketGeneration,\s*connectionEstablished,/);
  assert.match(source, /id=\{WEB_SOCKET_CLOSE_DIAGNOSTIC_ID\}/);
  assert.match(source, /hidden\s+aria-hidden="true"/);
  assert.doesNotMatch(source, /code\s*:\s*1012/);
});
