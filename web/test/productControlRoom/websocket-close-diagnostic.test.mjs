import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
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

test('production store records the diagnostic only inside the guarded real onclose path', async () => {
  const source = await readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8');
  assert.match(source, /ws\.onclose = \(event\) => \{/);
  assert.equal(
    (source.match(/setWebSocketCloseDiagnostic\s*\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source.match(/snapshotTrustedWebSocketCloseEvent\(event, socketGeneration\)/g) ?? []).length,
    1,
  );
  assert.match(source, /id=\{WEB_SOCKET_CLOSE_DIAGNOSTIC_ID\}/);
  assert.match(source, /hidden\s+aria-hidden="true"/);
  assert.doesNotMatch(source, /code\s*:\s*1012|setWebSocketCloseDiagnostic\([^s]/);
});
