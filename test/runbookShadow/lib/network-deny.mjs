import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

function replace(target, key, value, restore) {
  const original = target[key];
  target[key] = value;
  restore.push(() => { target[key] = original; });
}

export function installNetworkDeny() {
  let attempts = 0;
  const restore = [];
  function denied() {
    attempts += 1;
    throw new Error('RUNBOOK_SHADOW_NETWORK_FORBIDDEN');
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = denied;
  restore.push(() => { globalThis.fetch = originalFetch; });
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = denied;
  restore.push(() => { globalThis.WebSocket = originalWebSocket; });
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = denied;
  restore.push(() => { globalThis.EventSource = originalEventSource; });

  replace(http, 'ClientRequest', denied, restore);
  replace(http, 'request', denied, restore);
  replace(http, 'get', denied, restore);
  replace(http2, 'connect', denied, restore);
  replace(https, 'request', denied, restore);
  replace(https, 'get', denied, restore);
  replace(net, 'connect', denied, restore);
  replace(net, 'createConnection', denied, restore);
  replace(net.Socket.prototype, 'connect', denied, restore);
  replace(tls, 'connect', denied, restore);
  replace(dgram, 'createSocket', denied, restore);
  replace(dns, 'lookup', denied, restore);
  replace(dns, 'resolve', denied, restore);
  replace(dns, 'resolve4', denied, restore);
  replace(dns, 'resolve6', denied, restore);
  replace(dns.promises, 'lookup', denied, restore);
  replace(dns.promises, 'resolve', denied, restore);
  syncBuiltinESMExports();

  return Object.freeze({
    attempts: () => attempts,
    restore: () => {
      for (const action of restore.reverse()) action();
      syncBuiltinESMExports();
    },
  });
}
