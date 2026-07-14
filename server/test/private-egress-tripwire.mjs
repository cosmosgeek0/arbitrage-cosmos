/**
 * Deterministic-test network boundary.
 *
 * The historical filename is retained because release gates already preload
 * it. The boundary now denies every non-loopback request while preserving the
 * more specific private/signed/AWS classifications. Loopback HTTP, WebSocket,
 * TCP, and IPC remain available for local acceptance harnesses.
 */
import { appendFileSync } from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const INSTALL_KEY = Symbol.for('cosmos.test.network-egress-tripwire.v1');
const PRIVATE_KINDS = new Set([
  'BINANCE_PRIVATE_STREAM',
  'SIGNED_OR_AUTHENTICATED_REQUEST',
  'AWS_REQUEST',
]);

function normalizedHostname(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1);
  if (raw.startsWith('[') && raw.includes(']:')) return raw.slice(1, raw.indexOf(']:'));
  if (/^[^:]+:\d+$/.test(raw)) return raw.slice(0, raw.lastIndexOf(':'));
  return raw;
}

function isLoopbackHostname(value) {
  const host = normalizedHostname(value);
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(host) === 4) return host.split('.')[0] === '127';
  return false;
}

function headersContainPrivateAuthority(headers) {
  if (!headers) return false;
  try {
    const normalized = new Headers(headers);
    return normalized.has('x-mbx-apikey') || normalized.has('authorization');
  } catch {
    return false;
  }
}

function classify(url, headers) {
  const host = normalizedHostname(url.hostname);
  if (isLoopbackHostname(host)) return null;
  if (host === 'ws-api.binance.com') return 'BINANCE_PRIVATE_STREAM';
  if (url.searchParams.has('signature') || headersContainPrivateAuthority(headers)) {
    return 'SIGNED_OR_AUTHENTICATED_REQUEST';
  }
  if (host === '169.254.169.254' || host === '169.254.170.2' || host.endsWith('.amazonaws.com')) {
    return 'AWS_REQUEST';
  }
  return 'EXTERNAL_NETWORK_REQUEST';
}

function safeTarget(url) {
  return `${normalizedHostname(url.hostname)}${url.pathname || '/'}`;
}

function block(kind, url) {
  const sentinelPath = PRIVATE_KINDS.has(kind)
    ? process.env.PRIVATE_EGRESS_SENTINEL_FILE
    : process.env.NETWORK_EGRESS_SENTINEL_FILE;
  if (sentinelPath) appendFileSync(sentinelPath, `${kind} ${safeTarget(url)}\n`, 'utf8');
  const prefix = PRIVATE_KINDS.has(kind) ? 'PROHIBITED_PRIVATE_EGRESS' : 'PROHIBITED_EXTERNAL_EGRESS';
  const error = new Error(`${prefix}:${kind}`);
  error.code = 'ERR_TEST_NETWORK_EGRESS_BLOCKED';
  throw error;
}

function parsedRequest(input, options) {
  try {
    if (typeof input === 'string' || input instanceof URL) {
      return { url: new URL(input), headers: options?.headers };
    }
    if (typeof input?.url === 'string') {
      return {
        url: new URL(input.url),
        headers: options?.headers ?? input.headers,
      };
    }
    const protocol = typeof input?.protocol === 'string' ? input.protocol : 'https:';
    const hostname = typeof input?.hostname === 'string'
      ? input.hostname
      : typeof input?.host === 'string'
        ? input.host
        : 'localhost';
    const port = input?.port ? `:${input.port}` : '';
    const requestPath = typeof input?.path === 'string' ? input.path : '/';
    return {
      url: new URL(`${protocol}//${hostname}${port}${requestPath}`),
      headers: { ...(input?.headers ?? {}), ...(options?.headers ?? {}) },
    };
  } catch {
    return null;
  }
}

function parsedSocketRequest(args, protocol = 'tcp:') {
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    if (typeof first.path === 'string') return null;
    const host = first.host ?? first.hostname ?? 'localhost';
    const port = first.port ?? 0;
    const urlHost = String(host).includes(':') ? `[${String(host)}]` : String(host);
    return new URL(`${protocol}//${urlHost}:${String(port)}/`);
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  const host = typeof args[1] === 'string' ? args[1] : 'localhost';
  const port = typeof first === 'number' || /^\d+$/.test(String(first)) ? first : 0;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return new URL(`${protocol}//${urlHost}:${String(port)}/`);
}

function networkUrl(protocol, hostname, port = 0) {
  const host = String(hostname).includes(':') ? `[${String(hostname)}]` : String(hostname);
  return new URL(`${protocol}//${host}:${String(port)}/`);
}

function installRequestTripwire(module) {
  const originalRequest = module.request.bind(module);
  module.request = (...args) => {
    const parsed = parsedRequest(args[0], args[1]);
    if (parsed) {
      const kind = classify(parsed.url, parsed.headers);
      if (kind) block(kind, parsed.url);
    }
    return originalRequest(...args);
  };
  module.get = (...args) => {
    const request = module.request(...args);
    request.end();
    return request;
  };
}

function installSocketTripwire() {
  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const parsed = parsedSocketRequest(args);
    if (parsed) {
      const kind = classify(parsed);
      if (kind) block(kind, parsed);
    }
    return originalSocketConnect.apply(this, args);
  };

  const originalCreateConnection = net.createConnection.bind(net);
  const guardedCreateConnection = (...args) => {
    const parsed = parsedSocketRequest(args);
    if (parsed) {
      const kind = classify(parsed);
      if (kind) block(kind, parsed);
    }
    return originalCreateConnection(...args);
  };
  net.createConnection = guardedCreateConnection;
  net.connect = guardedCreateConnection;

  const originalTlsConnect = tls.connect.bind(tls);
  tls.connect = (...args) => {
    const parsed = parsedSocketRequest(args, 'tls:');
    if (parsed) {
      const kind = classify(parsed);
      if (kind) block(kind, parsed);
    }
    return originalTlsConnect(...args);
  };

  const originalDatagramConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function guardedDatagramConnect(...args) {
    const parsed = parsedSocketRequest(args, 'udp:');
    if (parsed) {
      const kind = classify(parsed);
      if (kind) block(kind, parsed);
    }
    return originalDatagramConnect.apply(this, args);
  };

  const originalDatagramSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedDatagramSend(...args) {
    const addressIndex = args.findIndex((value, index) => index > 0 && typeof value === 'string');
    const portIndex = addressIndex > 0
      ? args.slice(1, addressIndex).findIndex((value) => Number.isSafeInteger(value)) + 1
      : -1;
    if (addressIndex > 0 && portIndex > 0) {
      const parsed = parsedSocketRequest([args[portIndex], args[addressIndex]], 'udp:');
      if (parsed) {
        const kind = classify(parsed);
        if (kind) block(kind, parsed);
      }
    }
    return originalDatagramSend.apply(this, args);
  };
}

function installDnsTripwire() {
  const methods = [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse',
  ];
  const guard = (target, method) => {
    const original = target?.[method];
    if (typeof original !== 'function') return;
    target[method] = function guardedDnsOperation(...args) {
      const hostname = args[0];
      if (typeof hostname === 'string' && !isLoopbackHostname(hostname)) {
        const parsed = networkUrl('dns:', hostname);
        const kind = classify(parsed);
        if (kind) block(kind, parsed);
      }
      return original.apply(this, args);
    };
  };

  for (const method of methods) guard(dns, method);
  for (const method of methods) guard(dns.promises, method);
  for (const method of methods.filter((method) => method !== 'lookup' && method !== 'lookupService')) {
    guard(dns.Resolver.prototype, method);
  }
}

function install() {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const parsed = parsedRequest(input, init);
    if (parsed) {
      const kind = classify(parsed.url, parsed.headers);
      if (kind) {
        try {
          block(kind, parsed.url);
        } catch (error) {
          return Promise.reject(error);
        }
      }
    }
    return originalFetch(input, init);
  };

  installRequestTripwire(http);
  installRequestTripwire(https);
  installSocketTripwire();
  installDnsTripwire();
  syncBuiltinESMExports();
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;
  install();
}
