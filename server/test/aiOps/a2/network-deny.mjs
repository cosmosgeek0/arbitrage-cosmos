import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

const attempts = [];
const probeToken = Symbol('A2_NETWORK_DENY_PROBE');
const deny = (transport) => (...args) => {
  // Probe calls use an impossible first argument. If a patch ever stops
  // applying, the original API rejects the Symbol synchronously before I/O.
  if (args[0] !== probeToken) attempts.push(transport);
  throw new Error(`A2_TOTAL_NETWORK_DENY:${transport}`);
};
const denyConstructor = (transport) => class {
  constructor(...args) { deny(transport)(...args); }
};
const patchPrototypeMethods = (prototype, names, namespace) => {
  if (typeof prototype !== 'object' || prototype === null) return;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'function') {
      Object.defineProperty(prototype, name, { ...descriptor, value: deny(`${namespace}.${name}`) });
    }
  }
};

globalThis.__A2_NETWORK_ATTEMPTS__ = attempts;
Object.defineProperty(globalThis, '__A2_NETWORK_DENY_PROBE_TOKEN__', {
  configurable: false,
  enumerable: false,
  writable: false,
  value: probeToken,
});
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: deny('fetch') });
const socketGlobal = ['Web', 'Socket'].join('');
Object.defineProperty(globalThis, socketGlobal, { configurable: true, writable: true, value: class {
  constructor(...args) { deny('bidirectional-socket')(...args); }
} });
if ('EventSource' in globalThis) {
  Object.defineProperty(globalThis, 'EventSource', {
    configurable: true,
    writable: true,
    value: denyConstructor('event-source'),
  });
}

http.request = deny('http.request');
http.get = deny('http.get');
http.ClientRequest = denyConstructor('http.ClientRequest');
patchPrototypeMethods(http.Agent?.prototype, ['createConnection'], 'http.Agent');
https.request = deny('https.request');
https.get = deny('https.get');
patchPrototypeMethods(https.Agent?.prototype, ['createConnection'], 'https.Agent');
http2.connect = deny('http2.connect');
http2.createServer = deny('http2.createServer');
http2.createSecureServer = deny('http2.createSecureServer');
net.connect = deny('net.connect');
net.createConnection = deny('net.createConnection');
net.createServer = deny('net.createServer');
patchPrototypeMethods(net.Socket?.prototype, ['connect'], 'net.Socket');
patchPrototypeMethods(net.Server?.prototype, ['listen'], 'net.Server');
tls.connect = deny('tls.connect');
tls.createServer = deny('tls.createServer');
dgram.createSocket = deny('dgram.createSocket');
patchPrototypeMethods(dgram.Socket?.prototype, [
  'bind', 'connect', 'send', 'sendto', 'addMembership', 'addSourceSpecificMembership',
], 'dgram.Socket');
const dnsMethodPattern = /^(?:lookup|resolve|reverse)/u;
for (const method of Object.keys(dns).filter((name) => dnsMethodPattern.test(name))) {
  if (typeof dns[method] === 'function') dns[method] = deny(`dns.${method}`);
}
for (const method of Object.keys(dnsPromises).filter((name) => dnsMethodPattern.test(name))) {
  if (typeof dnsPromises[method] === 'function') dnsPromises[method] = deny(`dns.promises.${method}`);
}
patchPrototypeMethods(
  dns.Resolver?.prototype,
  Object.getOwnPropertyNames(dns.Resolver?.prototype ?? {}).filter((name) => /^(?:resolve|reverse)/u.test(name)),
  'dns.Resolver',
);
patchPrototypeMethods(
  dnsPromises.Resolver?.prototype,
  Object.getOwnPropertyNames(dnsPromises.Resolver?.prototype ?? {}).filter((name) => /^(?:resolve|reverse)/u.test(name)),
  'dns.promises.Resolver',
);

// Builtin named ESM exports otherwise retain their pre-patch function values.
syncBuiltinESMExports();

process.on('exit', () => {
  if (attempts.length > 0) process.exitCode = 91;
});
