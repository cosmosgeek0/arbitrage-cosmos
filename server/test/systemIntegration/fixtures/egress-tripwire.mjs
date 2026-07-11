import { createRequire, syncBuiltinESMExports } from 'node:module';

const ACTIVE_TRIPWIRE = Symbol.for('cosmos.systemIntegration.activeEgressTripwire');
const require = createRequire(import.meta.url);

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function patchValue(target, key, replacement, restorations) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined || (!descriptor.writable && !descriptor.configurable)) return false;
  const nextDescriptor = Object.hasOwn(descriptor, 'value')
    ? { ...descriptor, value: replacement }
    : {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: true,
        value: replacement,
      };
  Object.defineProperty(target, key, nextDescriptor);
  restorations.push(() => Object.defineProperty(target, key, descriptor));
  return true;
}

/** Inert until install() is called. */
export class EgressTripwire {
  #maximumAttempts;
  #attempts = [];
  #restorations = [];
  #installed = false;

  constructor(options = {}) {
    this.#maximumAttempts = positiveSafeInteger(options.maximumAttempts ?? 128, 'maximumAttempts');
    Object.seal(this);
  }

  #deny(channel) {
    if (this.#attempts.length < this.#maximumAttempts) {
      this.#attempts.push(Object.freeze({ sequence: this.#attempts.length + 1, channel }));
    }
    throw new Error(`EGRESS_FORBIDDEN:${channel}`);
  }

  install() {
    if (this.#installed) throw new Error('egress tripwire is already installed');
    if (globalThis[ACTIVE_TRIPWIRE] !== undefined) throw new Error('another egress tripwire is already installed');
    globalThis[ACTIVE_TRIPWIRE] = this;
    try {
      const http = require('node:http');
      const https = require('node:https');
      const net = require('node:net');
      const tls = require('node:tls');
      const deny = (channel) => (..._args) => this.#deny(channel);
      const tripwire = this;

      patchValue(globalThis, 'fetch', deny('global.fetch'), this.#restorations);
      patchValue(
        globalThis,
        'WebSocket',
        class ForbiddenWebSocket { constructor() { tripwire.#deny('global.WebSocket'); } },
        this.#restorations,
      );
      if (Object.hasOwn(globalThis, 'EventSource')) {
        patchValue(
          globalThis,
          'EventSource',
          class ForbiddenEventSource { constructor() { tripwire.#deny('global.EventSource'); } },
          this.#restorations,
        );
      }

      patchValue(http, 'request', deny('node:http.request'), this.#restorations);
      patchValue(http, 'get', deny('node:http.get'), this.#restorations);
      patchValue(http, 'ClientRequest', class ForbiddenClientRequest {
        constructor() { tripwire.#deny('node:http.ClientRequest'); }
      }, this.#restorations);
      patchValue(http.Agent.prototype, 'createConnection', deny('node:http.Agent.createConnection'), this.#restorations);
      patchValue(https, 'request', deny('node:https.request'), this.#restorations);
      patchValue(https, 'get', deny('node:https.get'), this.#restorations);
      patchValue(https.Agent.prototype, 'createConnection', deny('node:https.Agent.createConnection'), this.#restorations);
      patchValue(net, 'connect', deny('node:net.connect'), this.#restorations);
      patchValue(net, 'createConnection', deny('node:net.createConnection'), this.#restorations);
      patchValue(net.Socket.prototype, 'connect', deny('node:net.Socket.connect'), this.#restorations);
      patchValue(tls, 'connect', deny('node:tls.connect'), this.#restorations);
      patchValue(tls.TLSSocket.prototype, 'connect', deny('node:tls.TLSSocket.connect'), this.#restorations);
      syncBuiltinESMExports();
      this.#installed = true;
      return this;
    } catch (error) {
      this.#restorePatchedValues();
      delete globalThis[ACTIVE_TRIPWIRE];
      throw error;
    }
  }

  #restorePatchedValues() {
    for (const restore of this.#restorations.splice(0).reverse()) restore();
    syncBuiltinESMExports();
  }

  restore() {
    if (!this.#installed) return;
    this.#restorePatchedValues();
    if (globalThis[ACTIVE_TRIPWIRE] === this) delete globalThis[ACTIVE_TRIPWIRE];
    this.#installed = false;
  }

  assertNoAttempts(label = 'deterministic scenario') {
    if (this.#attempts.length > 0) {
      const channels = this.#attempts.map((attempt) => attempt.channel).join(', ');
      throw new Error(`${label} attempted forbidden egress: ${channels}`);
    }
  }

  snapshot() {
    return Object.freeze({
      installed: this.#installed,
      attemptCount: this.#attempts.length,
      attempts: Object.freeze([...this.#attempts]),
    });
  }
}

export function installEgressTripwire(options = {}) {
  return new EgressTripwire(options).install();
}
