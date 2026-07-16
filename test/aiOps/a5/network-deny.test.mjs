import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dnsPromises from 'node:dns/promises';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import test from 'node:test';
import tls from 'node:tls';

import { runCampaign } from '../../../fixtures/aiOps/a5/campaign.mjs';
import { networkDenyState, resetNetworkDenyAttempts } from './network-deny.mjs';

function isNetworkDenial(error) {
  return error?.code === 'A5_TOTAL_NETWORK_DENY' && /A5_TOTAL_NETWORK_DENY/u.test(error.message);
}

test('campaign execution performs no network operation under the deny-all preload', () => {
  assert.deepEqual(networkDenyState.attempts, [], 'no caught import-time attempt may be erased');
  const report = runCampaign();
  assert.equal(report.passedScenarioCount, 120);
  assert.deepEqual(networkDenyState.attempts, []);
});

test('tripwire blocks browser, HTTP, HTTP/2, TLS, TCP, Unix, DNS, UDP, and listener surfaces', async () => {
  resetNetworkDenyAttempts();
  await assert.rejects(fetch('http://127.0.0.1:1/a5-network-tripwire'), isNetworkDenial);
  assert.throws(() => new WebSocket('ws://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => http.get('http://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => http.request('http://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => http.createServer(), isNetworkDenial);
  assert.throws(() => https.get('https://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => https.request('https://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => https.createServer(), isNetworkDenial);
  assert.throws(() => http2.connect('https://127.0.0.1:1'), isNetworkDenial);
  assert.throws(() => http2.createServer(), isNetworkDenial);
  assert.throws(() => http2.createSecureServer(), isNetworkDenial);
  assert.throws(() => net.connect(1, '127.0.0.1'), isNetworkDenial);
  assert.throws(() => net.connect('/tmp/a5-network-tripwire.sock'), isNetworkDenial);
  assert.throws(() => net.createConnection(1, '127.0.0.1'), isNetworkDenial);
  assert.throws(() => new net.Socket().connect(1, '127.0.0.1'), isNetworkDenial);
  assert.throws(() => new net.Server().listen(1), isNetworkDenial);
  assert.throws(() => tls.connect(1, '127.0.0.1'), isNetworkDenial);
  assert.throws(() => tls.createServer(), isNetworkDenial);
  assert.throws(() => dns.lookup('a5-network-tripwire.invalid', () => {}), isNetworkDenial);
  assert.throws(() => dns.lookupService('127.0.0.1', 1, () => {}), isNetworkDenial);
  assert.throws(() => dns.resolveTxt('a5-network-tripwire.invalid', () => {}), isNetworkDenial);
  await assert.rejects(dnsPromises.lookup('a5-network-tripwire.invalid'), isNetworkDenial);
  await assert.rejects(dnsPromises.resolveMx('a5-network-tripwire.invalid'), isNetworkDenial);
  const resolver = new dns.Resolver();
  assert.throws(() => resolver.resolve4('a5-network-tripwire.invalid'), isNetworkDenial);
  const promiseResolver = new dnsPromises.Resolver();
  await assert.rejects(promiseResolver.resolve4('a5-network-tripwire.invalid'), isNetworkDenial);
  assert.throws(() => dns.setServers(['127.0.0.1']), isNetworkDenial);
  assert.throws(() => dgram.createSocket('udp4'), isNetworkDenial);
  assert.throws(() => net.createServer(), isNetworkDenial);
  assert.deepEqual(networkDenyState.attempts, [
    'fetch',
    'websocket',
    'http.get',
    'http.request',
    'http.createServer',
    'https.get',
    'https.request',
    'https.createServer',
    'http2.connect',
    'http2.createServer',
    'http2.createSecureServer',
    'net.connect',
    'net.connect',
    'net.createConnection',
    'net.Socket.connect',
    'net.Server.listen',
    'tls.connect',
    'tls.createServer',
    'dns.lookup',
    'dns.lookupService',
    'dns.resolveTxt',
    'dns.promises.lookup',
    'dns.promises.resolveMx',
    'dns.Resolver.resolve4',
    'dns.promises.Resolver.resolve4',
    'dns.setServers',
    'dgram.createSocket',
    'net.createServer',
  ]);
});
