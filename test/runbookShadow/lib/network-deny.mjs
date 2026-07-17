import dgram from 'node:dgram';
import dns from 'node:dns';
import http2 from 'node:http2';
import { syncBuiltinESMExports } from 'node:module';

import { installEgressTripwire } from '../../../server/test/systemIntegration/fixtures/egress-tripwire.mjs';

function patchValue(target, key, replacement, restorations) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined || (!descriptor.writable && !descriptor.configurable)) return false;
  Object.defineProperty(target, key, { ...descriptor, value: replacement });
  restorations.push(() => Object.defineProperty(target, key, descriptor));
  return true;
}

/**
 * Reuses the canonical System Integration egress tripwire and adds only the
 * transport families it does not own: HTTP/2, UDP, and DNS.
 */
export function installNetworkDeny() {
  const core = installEgressTripwire({ maximumAttempts: 128 });
  const restorations = [];
  const supplementalAttempts = [];

  function deny(channel) {
    supplementalAttempts.push(channel);
    throw new Error(`RUNBOOK_PORT_NETWORK_FORBIDDEN:${channel.replaceAll(':', '_').replaceAll('.', '_')}`);
  }

  function patchRequired(target, key, channel) {
    if (!patchValue(target, key, () => deny(channel), restorations)) {
      throw new Error(`RUNBOOK_PORT_NETWORK_DENY_INSTALL_INCOMPLETE:${channel}`);
    }
  }

  try {
    patchRequired(http2, 'connect', 'node:http2.connect');
    patchRequired(dgram, 'createSocket', 'node:dgram.createSocket');
    for (const method of ['bind', 'connect', 'send']) {
      patchRequired(dgram.Socket.prototype, method, `node:dgram.Socket.${method}`);
    }
    const dnsMethods = [
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
    for (const method of dnsMethods) {
      patchRequired(dns, method, `node:dns.${method}`);
      if (typeof dns.promises[method] === 'function') {
        patchRequired(dns.promises, method, `node:dns.promises.${method}`);
      }
    }
    const resolverMethods = dnsMethods.filter((method) => !['lookup', 'lookupService'].includes(method));
    for (const method of resolverMethods) {
      patchRequired(dns.Resolver.prototype, method, `node:dns.Resolver.${method}`);
      patchRequired(dns.promises.Resolver.prototype, method, `node:dns.promises.Resolver.${method}`);
    }
    syncBuiltinESMExports();
  } catch (error) {
    for (const restore of restorations.reverse()) restore();
    syncBuiltinESMExports();
    core.restore();
    throw error;
  }

  return Object.freeze({
    attempts: () => core.snapshot().attemptCount + supplementalAttempts.length,
    restore: () => {
      for (const restore of restorations.reverse()) restore();
      syncBuiltinESMExports();
      core.restore();
    },
  });
}
