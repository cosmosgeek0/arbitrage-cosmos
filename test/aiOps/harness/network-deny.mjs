import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const STATE_SYMBOL = Symbol.for('aiops.a5.totalNetworkDeny.state');
const state = globalThis[STATE_SYMBOL] ?? {
  installed: false,
  attempts: [],
};
globalThis[STATE_SYMBOL] = state;

function denialError(kind) {
  state.attempts.push(kind);
  const error = new Error(`A5_TOTAL_NETWORK_DENY:${kind}`);
  error.code = 'A5_TOTAL_NETWORK_DENY';
  error.networkKind = kind;
  return error;
}

function deny(kind) {
  return function deniedNetworkOperation() {
    throw denialError(kind);
  };
}

function denyAsync(kind) {
  return function deniedAsyncNetworkOperation() {
    return Promise.reject(denialError(kind));
  };
}

if (!state.installed) {
  state.installed = true;

  globalThis.fetch = denyAsync('fetch');
  globalThis.WebSocket = class DeniedWebSocket {
    constructor() {
      throw denialError('websocket');
    }
  };

  http.request = deny('http.request');
  http.get = deny('http.get');
  http.createServer = deny('http.createServer');
  https.request = deny('https.request');
  https.get = deny('https.get');
  https.createServer = deny('https.createServer');
  http2.connect = deny('http2.connect');
  http2.createServer = deny('http2.createServer');
  http2.createSecureServer = deny('http2.createSecureServer');

  net.connect = deny('net.connect');
  net.createConnection = deny('net.createConnection');
  net.createServer = deny('net.createServer');
  net.Socket.prototype.connect = deny('net.Socket.connect');
  net.Server.prototype.listen = deny('net.Server.listen');
  tls.connect = deny('tls.connect');
  tls.createServer = deny('tls.createServer');

  for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) {
    dns[method] = deny(`dns.${method}`);
    dnsPromises[method] = denyAsync(`dns.promises.${method}`);
  }
  for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
    if (typeof dns.Resolver?.prototype?.[method] === 'function') {
      dns.Resolver.prototype[method] = deny(`dns.Resolver.${method}`);
    }
    if (typeof dnsPromises.Resolver?.prototype?.[method] === 'function') {
      dnsPromises.Resolver.prototype[method] = denyAsync(`dns.promises.Resolver.${method}`);
    }
  }
  dns.setServers = deny('dns.setServers');
  dgram.createSocket = deny('dgram.createSocket');

  syncBuiltinESMExports();
}

export const networkDenyState = state;

export function resetNetworkDenyAttempts() {
  state.attempts.length = 0;
}
