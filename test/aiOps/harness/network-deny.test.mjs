import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dnsPromises from 'node:dns/promises';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

import { runCampaign } from '../../../fixtures/aiOps/harness/campaign.mjs';
import { networkDenyState, resetNetworkDenyAttempts } from './network-deny.mjs';

function isNetworkDenial(error) {
  return error?.code === 'A5_TOTAL_NETWORK_DENY' && /A5_TOTAL_NETWORK_DENY/u.test(error.message);
}

test('campaign execution performs no network operation under the deny-all preload', () => {
  resetNetworkDenyAttempts();
  const report = runCampaign();
  assert.equal(report.passedScenarioCount, 120);
  assert.deepEqual(networkDenyState.attempts, []);
});

test('tripwire blocks fetch, WebSocket, HTTP, TCP, Unix socket, DNS, UDP, and listeners', async () => {
  resetNetworkDenyAttempts();
  await assert.rejects(fetch('http://127.0.0.1:1/a5-network-tripwire'), isNetworkDenial);
  assert.throws(() => new WebSocket('ws://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => http.get('http://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => net.connect(1, '127.0.0.1'), isNetworkDenial);
  assert.throws(() => net.connect('/tmp/a5-network-tripwire.sock'), isNetworkDenial);
  await assert.rejects(dnsPromises.lookup('a5-network-tripwire.invalid'), isNetworkDenial);
  const resolver = new dns.Resolver();
  assert.throws(() => resolver.resolve4('a5-network-tripwire.invalid'), isNetworkDenial);
  assert.throws(() => dgram.createSocket('udp4'), isNetworkDenial);
  assert.throws(() => net.createServer(), isNetworkDenial);
  assert.deepEqual(networkDenyState.attempts, [
    'fetch',
    'websocket',
    'http.get',
    'net.connect',
    'net.connect',
    'dns.promises.lookup',
    'dns.Resolver.resolve4',
    'dgram.createSocket',
    'net.createServer',
  ]);
});
