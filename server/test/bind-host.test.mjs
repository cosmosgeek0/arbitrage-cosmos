import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBindHost, resolveBindPort } from '../dist/bootstrap/bind.js';

test('bind host resolution is loopback-only and fails closed', () => {
  // unset and empty are the only "not configured" cases -> safe default.
  // Before the fix, `HOST ?? '127.0.0.1'` passed '' straight to listen(),
  // which binds :: on every interface — proven LAN-reachable by V3.
  assert.equal(resolveBindHost(undefined), '127.0.0.1');
  assert.equal(resolveBindHost(''), '127.0.0.1');
  assert.equal(resolveBindHost('   '), '127.0.0.1');
  assert.equal(resolveBindHost('\t'), '127.0.0.1');

  // explicit loopback literals pass through
  assert.equal(resolveBindHost('127.0.0.1'), '127.0.0.1');
  assert.equal(resolveBindHost(' 127.0.0.1 '), '127.0.0.1');
  assert.equal(resolveBindHost('::1'), '::1');
  assert.equal(resolveBindHost('localhost'), 'localhost');

  // everything else fails closed — never silently defaulted
  for (const hostile of ['0.0.0.0', '::', ' 0.0.0.0', '192.168.1.20', '10.0.0.1', 'evil.example', '127.0.0.2']) {
    assert.throws(() => resolveBindHost(hostile), /HOST_BIND_ADDRESS_NOT_LOOPBACK/, hostile);
  }
});

test('bind port resolution rejects the empty-string ephemeral trap', () => {
  assert.equal(resolveBindPort(undefined), 8080);
  // Before the fix, Number('') === 0 -> listen(0) -> random ephemeral port.
  assert.equal(resolveBindPort(''), 8080);
  assert.equal(resolveBindPort('   '), 8080);
  assert.equal(resolveBindPort('8080'), 8080);
  assert.equal(resolveBindPort('1024'), 1024);
  assert.equal(resolveBindPort('65535'), 65535);
  for (const invalid of ['abc', '80', '0', '-1', '65536', '8080.5', '0x1F90', '8080 extra']) {
    assert.throws(() => resolveBindPort(invalid), /PORT_INVALID/, invalid);
  }
});
