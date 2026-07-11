#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { OperatorAccess, isLoopbackAddress } from '../dist/security/access.js';

function request({ address = '127.0.0.1', host = 'localhost:8080', method = 'GET', headers = {} } = {}) {
  return {
    method,
    headers: { host, ...headers },
    socket: { remoteAddress: address },
  };
}

test('loopback detection does not confuse remote addresses with localhost', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('10.0.0.8'), false);
});

test('local admission requires both a loopback peer and canonical local Host', async () => {
  const access = new OperatorAccess();
  assert.equal((await access.verify(request())).authorized, true);
  assert.equal((await access.verify(request({ address: '10.0.0.8' }))).authorized, false);
  assert.equal((await access.verify(request({ host: 'example.test' }))).authorized, false);
  assert.equal((await access.verify(request({ host: '127.0.0.1:99999' }))).authorized, false);
});

test('edge markers disable local bypass', async () => {
  const result = await new OperatorAccess().verify(request({ headers: { 'x-forwarded-for': '127.0.0.1' } }));
  assert.equal(result.authorized, false);
  assert.notEqual(result.operator?.source, 'loopback');
});

test('local unsafe calls permit originless CLI use but reject a supplied foreign Origin', async () => {
  const access = new OperatorAccess();
  assert.equal((await access.verify(request({ method: 'POST' }))).authorized, true);
  const foreign = await access.verify(request({ method: 'POST', headers: { origin: 'https://evil.example' } }));
  assert.equal(foreign.authorized, false);
  assert.equal(foreign.code, 'ORIGIN_MISMATCH');
});

test('Fetch Metadata blocks cross-site browser GETs, including localhost targets', async () => {
  const result = await new OperatorAccess().verify(request({ headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(result.authorized, false);
  assert.equal(result.code, 'CROSS_SITE_REQUEST');
  const sameOrigin = await new OperatorAccess().verify(request({ headers: { 'sec-fetch-site': 'same-origin' } }));
  assert.equal(sameOrigin.authorized, true);
});

test('WebSocket admission rejects foreign origins and requires Origin remotely', async () => {
  const access = new OperatorAccess();
  const foreign = await access.verify(request({ headers: { origin: 'https://evil.example' } }), { websocket: true });
  assert.equal(foreign.authorized, false);
  assert.equal(foreign.code, 'ORIGIN_MISMATCH');

  const remote = await access.verify(request({ address: '10.0.0.8', host: 'control.example' }), { websocket: true });
  assert.equal(remote.authorized, false);
  assert.equal(remote.code, 'ORIGIN_REQUIRED');
});
