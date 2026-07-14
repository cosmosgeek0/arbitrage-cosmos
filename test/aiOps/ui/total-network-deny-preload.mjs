import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const ATTEMPTS_KEY = Symbol.for('aiops.a4.total-network-attempts.v1');
const GUARD_KEY = Symbol.for('aiops.a4.total-network-guard.v1');
const INSTALL_KEY = Symbol.for('aiops.a4.total-network-preload-installed.v1');

const existingLedger = globalThis[ATTEMPTS_KEY];
if (existingLedger !== undefined && (
  !Array.isArray(existingLedger)
  || existingLedger.preloadInstalled !== true
  || existingLedger.version !== 1
)) {
  throw new Error('AIOPS_A4_TOTAL_NETWORK_LEDGER_COLLISION');
}

const attempts = existingLedger ?? [];
if (existingLedger === undefined) {
  Object.defineProperties(attempts, {
    preloadInstalled: { value: true, enumerable: false },
    version: { value: 1, enumerable: false },
  });
  Object.defineProperty(globalThis, ATTEMPTS_KEY, {
    value: attempts,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function safeTarget(value) {
  if (Array.isArray(value)) return safeTarget(value[0]);
  if (value instanceof URL) return `${value.protocol}//${value.host}${value.pathname}`;
  if (typeof value === 'string') return value.split(/[?#]/u, 1)[0] || 'string';
  if (value && typeof value === 'object') {
    const candidate = value.hostname ?? value.host ?? value.path ?? value.url ?? value.href;
    if (candidate !== undefined) return safeTarget(candidate);
    return value.constructor?.name ?? 'object';
  }
  return value === undefined ? 'unknown' : String(value);
}

function deny(kind, target = 'unknown') {
  attempts.push({ kind, target: safeTarget(target) });
  const error = new Error(`AIOPS_A4_TOTAL_NETWORK_DENY:${kind}`);
  error.code = 'ERR_AIOPS_A4_NETWORK_DENIED';
  throw error;
}

function deniedFunction(kind, targetFromArgs = (args) => args[0]) {
  const guarded = function aiOpsA4TotalNetworkDenied(...args) {
    return deny(kind, targetFromArgs(args));
  };
  Object.defineProperty(guarded, GUARD_KEY, { value: kind });
  return guarded;
}

function guardedFunction(original, kind, allowArgs, targetFromArgs = (args) => args[0]) {
  const guarded = function aiOpsA4NetworkGuard(...args) {
    if (allowArgs(args)) return Reflect.apply(original, this, args);
    return deny(kind, targetFromArgs(args));
  };
  Object.defineProperty(guarded, GUARD_KEY, { value: kind });
  return guarded;
}

function deniedConstructor(kind) {
  class AiOpsA4TotalNetworkDenied {
    constructor(...args) {
      deny(kind, args[0]);
    }
  }
  Object.defineProperty(AiOpsA4TotalNetworkDenied, GUARD_KEY, { value: kind });
  return AiOpsA4TotalNetworkDenied;
}

function guardedConstructor(original, kind, allowArgs) {
  const guarded = new Proxy(original, {
    construct(target, args, newTarget) {
      if (allowArgs(args)) return Reflect.construct(target, args, newTarget);
      return deny(kind, args[0]);
    },
  });
  Object.defineProperty(guarded, GUARD_KEY, { value: kind });
  return guarded;
}

function isIpcSocketArgs(args) {
  const first = args[0];
  if (Array.isArray(first)) return isIpcSocketArgs(first);
  if (typeof first === 'string') return !/^\d+$/u.test(first);
  return Boolean(first && typeof first === 'object' && typeof first.path === 'string');
}

function isIpcHttpArgs(args) {
  const first = args[0];
  const options = args[1];
  return Boolean(
    first && typeof first === 'object' && typeof first.socketPath === 'string'
    || options && typeof options === 'object' && typeof options.socketPath === 'string',
  );
}

function installBrowserGuards() {
  globalThis.fetch = deniedFunction('fetch');
  globalThis.WebSocket = deniedConstructor('WebSocket');
  globalThis.EventSource = deniedConstructor('EventSource');
  globalThis.XMLHttpRequest = deniedConstructor('XMLHttpRequest');
  globalThis.Worker = deniedConstructor('Worker');
  globalThis.SharedWorker = deniedConstructor('SharedWorker');
  globalThis.Image = deniedConstructor('Image');

  if (typeof globalThis.navigator?.sendBeacon === 'function') {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: deniedFunction('navigator.sendBeacon'),
      configurable: true,
      writable: true,
    });
  }
}

function installHttpGuards(module, protocol) {
  module.request = guardedFunction(module.request, `${protocol}.request`, isIpcHttpArgs);
  module.get = guardedFunction(module.get, `${protocol}.get`, isIpcHttpArgs);
  if (typeof module.ClientRequest === 'function') {
    module.ClientRequest = guardedConstructor(module.ClientRequest, `${protocol}.ClientRequest`, isIpcHttpArgs);
  }
}

function installTcpAndTlsGuards() {
  net.connect = guardedFunction(net.connect, 'net.connect', isIpcSocketArgs);
  net.createConnection = guardedFunction(net.createConnection, 'net.createConnection', isIpcSocketArgs);
  net.Socket.prototype.connect = guardedFunction(net.Socket.prototype.connect, 'net.Socket.connect', isIpcSocketArgs);
  net.Server.prototype.listen = guardedFunction(net.Server.prototype.listen, 'net.Server.listen', isIpcSocketArgs);

  tls.connect = deniedFunction('tls.connect');
  if (typeof tls.TLSSocket.prototype.connect === 'function') {
    tls.TLSSocket.prototype.connect = deniedFunction('tls.TLSSocket.connect');
  }
}

const DNS_METHODS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
];

function guardDnsTarget(target, prefix) {
  for (const method of DNS_METHODS) {
    if (typeof target?.[method] === 'function') {
      target[method] = deniedFunction(`${prefix}.${method}`);
    }
  }
}

function installDnsGuards() {
  guardDnsTarget(dns, 'dns');
  guardDnsTarget(dnsPromises, 'dns.promises');
  guardDnsTarget(dns.Resolver?.prototype, 'dns.Resolver');
  guardDnsTarget(dnsPromises.Resolver?.prototype, 'dns.promises.Resolver');
}

function installDatagramGuards() {
  dgram.createSocket = deniedFunction('dgram.createSocket');
  dgram.Socket.prototype.bind = deniedFunction('dgram.Socket.bind');
  dgram.Socket.prototype.connect = deniedFunction('dgram.Socket.connect');
  dgram.Socket.prototype.send = deniedFunction(
    'dgram.Socket.send',
    (args) => args.findLast((value) => typeof value === 'string') ?? 'datagram',
  );
}

function install() {
  installBrowserGuards();
  installHttpGuards(http, 'http');
  installHttpGuards(https, 'https');
  http2.connect = deniedFunction('http2.connect');
  installTcpAndTlsGuards();
  installDnsGuards();
  installDatagramGuards();

  // Keep later named ESM imports aligned with the guarded CommonJS exports.
  syncBuiltinESMExports();
}

if (!globalThis[INSTALL_KEY]) {
  install();
  Object.defineProperty(globalThis, INSTALL_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export function networkAttempts() {
  return attempts.map((attempt) => ({ ...attempt }));
}
