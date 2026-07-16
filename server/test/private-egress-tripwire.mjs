/**
 * Deterministic-test network boundary.
 *
 * The historical filename is retained because release gates already preload
 * it. The boundary denies non-loopback traffic across the Node surfaces used
 * by the controlled test graph while preserving specific private/signed/AWS
 * classifications. Numeric loopback HTTP, WebSocket, TCP, and TLS remain
 * available for local acceptance harnesses.
 *
 * Strict mode latches a caught attempt into the child exit status. The root
 * wrapper also treats the shared JSONL transcript as authoritative, so a
 * descendant cannot hide an attempt by catching an error or resetting its own
 * exit status.
 */
import { appendFileSync } from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { urlToHttpOptions } from 'node:url';
import workerThreads, { isMainThread, threadId } from 'node:worker_threads';

const INSTALL_KEY = Symbol.for('cosmos.test.network-egress-tripwire.v2');
const REPORT_VERSION = 2;
const STRICT_EXIT_CODE = 86;
const MAX_RECORDED_ATTEMPTS = 64;
const STRICT_ENV = 'I00_TEST_EGRESS_STRICT';
const REPORT_ENV = 'I00_TEST_EGRESS_REPORT_FILE';
const PRIVATE_SENTINEL_ENV = 'PRIVATE_EGRESS_SENTINEL_FILE';
const NETWORK_SENTINEL_ENV = 'NETWORK_EGRESS_SENTINEL_FILE';
const TRIPWIRE_IMPORT_OPTION = `--import=${import.meta.url}`;
const SAFE_CONNECTORS = new Set();
const PRIVATE_KINDS = new Set([
  'BINANCE_PRIVATE_STREAM',
  'SIGNED_OR_AUTHENTICATED_REQUEST',
  'AWS_REQUEST',
]);
const PRIVATE_STREAM_HOSTS = new Set([
  'ws-api.binance.com',
  'ws-fapi.binance.com',
  'margin-stream.binance.com',
]);
const LOOPBACKS = new net.BlockList();
LOOPBACKS.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACKS.addAddress('::1', 'ipv6');
LOOPBACKS.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

function exactFlag(name) {
  const configured = process.env[name];
  if (configured === undefined) return false;
  if (configured === '1') return true;
  throw new TypeError(`${name} must be absent or exactly 1`);
}

function capturedPath(name) {
  const configured = process.env[name];
  if (configured === undefined) return null;
  if (configured.length === 0) throw new TypeError(`${name} must be absent or a non-empty path`);
  return configured;
}

const strict = exactFlag(STRICT_ENV);
const reportPath = capturedPath(REPORT_ENV);
const privateSentinelPath = capturedPath(PRIVATE_SENTINEL_ENV);
const networkSentinelPath = capturedPath(NETWORK_SENTINEL_ENV);
let attemptCount = 0;
let overflowRecorded = false;

function appendJsonLine(pathname, record) {
  appendFileSync(pathname, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
}

function report(record) {
  if (reportPath === null) return;
  appendJsonLine(reportPath, Object.freeze({
    version: REPORT_VERSION,
    pid: process.pid,
    threadId,
    mainThread: isMainThread,
    ...record,
  }));
}

function normalizedHostname(value) {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\.$/u, '');
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end > 0) return raw.slice(1, end);
  }
  if (net.isIP(raw) !== 0) return raw;
  const separator = raw.lastIndexOf(':');
  if (
    separator > 0 &&
    !raw.slice(0, separator).includes(':') &&
    /^\d+$/u.test(raw.slice(separator + 1))
  ) {
    return raw.slice(0, separator);
  }
  return raw;
}

function isLoopbackHostname(value) {
  const host = normalizedHostname(value);
  const family = net.isIP(host);
  if (family === 4) return LOOPBACKS.check(host, 'ipv4');
  if (family === 6) return LOOPBACKS.check(host, 'ipv6');
  return false;
}

function isExactLoopbackAddress(value) {
  if (typeof value !== 'string') return false;
  const family = net.isIP(value);
  if (family === 4) return LOOPBACKS.check(value, 'ipv4');
  if (family === 6) return LOOPBACKS.check(value, 'ipv6');
  return false;
}

function isValidRawHostname(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  if (value !== value.trim() || value.endsWith('.')) return false;
  if (net.isIP(value) !== 0) return true;
  if (!/^[A-Za-z0-9.-]+$/u.test(value)) return false;
  const labels = value.split('.');
  if (labels.some((label) => (
    label.length === 0 || label.length > 63 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  ))) {
    return false;
  }
  try {
    const canonical = normalizedHostname(new URL(`tcp://${value}:1/`).hostname);
    if (net.isIP(canonical) !== 0) return false;
  } catch {
    return false;
  }
  return true;
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
  if (
    PRIVATE_STREAM_HOSTS.has(host) ||
    (host === 'fstream.binance.com' && /^\/private(?:\/|$)/u.test(url.pathname))
  ) {
    return 'BINANCE_PRIVATE_STREAM';
  }
  if (url.searchParams.has('signature') || headersContainPrivateAuthority(headers)) {
    return 'SIGNED_OR_AUTHENTICATED_REQUEST';
  }
  if (host === '169.254.169.254' || host === '169.254.170.2' || host.endsWith('.amazonaws.com')) {
    return 'AWS_REQUEST';
  }
  return 'EXTERNAL_NETWORK_REQUEST';
}

function safeTarget(url) {
  const host = normalizedHostname(url.hostname);
  const bracketed = net.isIP(host) === 6 ? `[${host}]` : host;
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${bracketed}${port}`;
}

function latchFailure() {
  if (!strict || attemptCount === 0) return;
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = STRICT_EXIT_CODE;
}

function appendLegacySentinel(kind, channel, url) {
  const sentinelPath = PRIVATE_KINDS.has(kind) ? privateSentinelPath : networkSentinelPath;
  if (sentinelPath === null) return;
  appendFileSync(sentinelPath, `${channel} ${kind} ${safeTarget(url)}\n`, 'utf8');
}

function block(kind, url, channel) {
  attemptCount += 1;
  latchFailure();
  const target = safeTarget(url);
  let evidenceFailure = null;
  try {
    if (attemptCount <= MAX_RECORDED_ATTEMPTS) {
      report({ kind: 'ATTEMPT', sequence: attemptCount, channel, classification: kind, target });
      appendLegacySentinel(kind, channel, url);
      process.stderr.write(`[TEST_EGRESS_ATTEMPT] ${channel} ${kind} ${target}\n`);
    } else if (!overflowRecorded) {
      overflowRecorded = true;
      report({
        kind: 'ATTEMPT_OVERFLOW',
        sequence: attemptCount,
        maximumRecordedAttempts: MAX_RECORDED_ATTEMPTS,
      });
      process.stderr.write(
        `[TEST_EGRESS_ATTEMPT_OVERFLOW] maximum=${MAX_RECORDED_ATTEMPTS}\n`,
      );
    }
  } catch (error) {
    evidenceFailure = error instanceof Error ? error.message : String(error);
    latchFailure();
  }

  const prefix = PRIVATE_KINDS.has(kind) ? 'PROHIBITED_PRIVATE_EGRESS' : 'PROHIBITED_EXTERNAL_EGRESS';
  const error = new Error(
    `${prefix}:${channel}:${kind}${evidenceFailure === null ? '' : ':EVIDENCE_WRITE_FAILED'}`,
  );
  error.code = 'ERR_TEST_NETWORK_EGRESS_BLOCKED';
  error.channel = channel;
  error.classification = kind;
  error.target = target;
  if (evidenceFailure !== null) error.cause = new Error(evidenceFailure);
  throw error;
}

function isOptions(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(target, key) {
  return isOptions(target) && Object.prototype.hasOwnProperty.call(target, key);
}

function selectedHost(options) {
  if (owns(options, 'hostname') && options.hostname !== undefined && options.hostname !== null) {
    const selected = String(options.hostname);
    if (selected.length > 0) return selected;
  }
  if (owns(options, 'host') && options.host !== undefined && options.host !== null) {
    const selected = String(options.host);
    if (selected.length > 0) return selected;
  }
  return null;
}

function parsedRequest(input, options, defaultProtocol = 'https:') {
  try {
    let baseOptions = {};
    let canonicalHostname = null;
    if (typeof input === 'string' || input instanceof URL) {
      baseOptions = urlToHttpOptions(new URL(input));
      canonicalHostname = baseOptions.hostname;
    } else if (typeof input?.url === 'string') {
      baseOptions = {
        ...urlToHttpOptions(new URL(input.url)),
        headers: input.headers,
      };
      canonicalHostname = baseOptions.hostname;
    } else if (isOptions(input)) {
      baseOptions = input;
    } else {
      return null;
    }

    const overrides = isOptions(options) ? options : {};
    const effective = { ...baseOptions, ...overrides };
    const socketPath = effective.socketPath;
    if (typeof socketPath === 'string' && socketPath.length > 0) {
      return {
        url: new URL('unix://local'),
        headers: effective.headers ?? null,
        transportOptions: effective,
      };
    }

    const host = selectedHost(effective);
    if (host === null) return null;
    const hostIsCanonical = canonicalHostname !== null &&
      !owns(overrides, 'hostname') &&
      effective.hostname === canonicalHostname;
    if (!hostIsCanonical && !isValidRawHostname(host)) return null;

    const protocol = String(effective.protocol ?? defaultProtocol);
    if (!/^[a-z][a-z0-9+.-]*:$/iu.test(protocol)) return null;
    const explicitPort = effective.port;
    const port = explicitPort === null || explicitPort === undefined || explicitPort === ''
      ? ''
      : String(explicitPort);
    if (port !== '' && !/^\d+$/u.test(port)) return null;

    const hostname = hostIsCanonical ? normalizedHostname(host) : host;
    const formattedHost = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
    const url = new URL(`${protocol}//${formattedHost}${port === '' ? '' : `:${port}`}/`);
    const requestPath = String(effective.path ?? `${effective.pathname ?? '/'}${effective.search ?? ''}`);
    const queryIndex = requestPath.indexOf('?');
    const pathname = queryIndex === -1 ? requestPath : requestPath.slice(0, queryIndex);
    const search = queryIndex === -1 ? '' : requestPath.slice(queryIndex);
    url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
    url.search = search;
    return {
      url,
      headers: effective.headers ?? null,
      transportOptions: effective,
    };
  } catch {
    return null;
  }
}

function networkUrl(protocol, hostname, port = 0) {
  if (!isValidRawHostname(hostname)) throw new TypeError('raw network hostname is invalid');
  const selectedPort = String(port);
  if (!/^\d+$/u.test(selectedPort)) throw new TypeError('raw network port is invalid');
  const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return new URL(`${protocol}//${host}:${selectedPort}/`);
}

function parsedSocketRequest(args, protocol = 'tcp:') {
  const first = args[0];
  if (Array.isArray(first)) return parsedSocketRequest(first, protocol);
  if (isOptions(first)) {
    if (typeof first.path === 'string' || first.socket !== undefined) return null;
    return networkUrl(protocol, first.host ?? first.hostname ?? 'localhost', first.port ?? 0);
  }
  if (typeof first === 'string') return null;
  if (!Number.isSafeInteger(first) || first < 0) return null;
  const host = typeof args[1] === 'string' ? args[1] : 'localhost';
  return networkUrl(protocol, host, first);
}

function parsedTlsRequest(args) {
  const first = args[0];
  if (isOptions(first)) {
    if (first.socket !== undefined) return null;
    if (typeof first.path === 'string') return null;
    return networkUrl('tls:', first.host ?? first.hostname ?? 'localhost', first.port ?? 0);
  }
  if (typeof first === 'string') return null;
  if (!Number.isSafeInteger(first) || first < 0) return null;
  const second = args[1];
  const third = args[2];
  const options = isOptions(second) ? second : isOptions(third) ? third : {};
  if (options.socket !== undefined) return null;
  if (typeof options.path === 'string') return null;
  const positionalHost = typeof second === 'string' ? second : 'localhost';
  const host = options.host ?? options.hostname ?? positionalHost;
  return networkUrl('tls:', host, options.port ?? first);
}

function parsedDatagramSend(args) {
  const values = args.slice(1);
  if (typeof values.at(-1) === 'function') values.pop();
  if (values.length === 0) return null;

  let port = null;
  let address = null;
  if (
    values.length >= 3 &&
    Number.isSafeInteger(values[0]) &&
    Number.isSafeInteger(values[1]) &&
    Number.isSafeInteger(values[2])
  ) {
    port = values[2];
    address = typeof values[3] === 'string' ? values[3] : '127.0.0.1';
  } else if (Number.isSafeInteger(values[0])) {
    port = values[0];
    address = typeof values[1] === 'string' ? values[1] : '127.0.0.1';
  }
  if (port === null) return null;
  return networkUrl('udp:', address, port);
}

function patchValue(target, key, replacement, optional = false) {
  const current = target?.[key];
  if (typeof current !== 'function') {
    if (optional) return false;
    throw new TypeError(`required egress surface ${String(key)} is unavailable`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor !== undefined && descriptor.configurable === false && descriptor.writable === false) {
    throw new TypeError(`required egress surface ${String(key)} cannot be patched`);
  }
  Object.defineProperty(target, key, {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? false,
    writable: true,
    value: replacement,
  });
  return true;
}

function guardParsedRequest(input, options, channel, defaultProtocol) {
  const parsed = parsedRequest(input, options, defaultProtocol);
  if (parsed === null) {
    block('EXTERNAL_NETWORK_REQUEST', new URL(`${defaultProtocol}//unparseable.invalid/`), channel);
  }
  if (parsed.url !== null) {
    const kind = classify(parsed.url, parsed.headers);
    if (kind) block(kind, parsed.url, channel);
  }
  return parsed;
}

function guardOpaqueRequestConnector(parsed, module, channel) {
  if (!strict) return;
  const options = parsed.transportOptions;
  if (!isOptions(options)) return;
  const target = parsed.url ?? new URL('https://unparseable.invalid/');
  if (
    typeof options.createConnection === 'function' &&
    !SAFE_CONNECTORS.has(options.createConnection)
  ) {
    block('EXTERNAL_NETWORK_REQUEST', target, channel);
  }
  const isCanonicalAgent = (agent) => (
    agent !== null && typeof agent === 'object' &&
      Object.getPrototypeOf(agent) === module.Agent.prototype &&
      !owns(agent, 'addRequest') &&
      !owns(agent, 'createSocket') &&
      !owns(agent, 'createConnection') &&
      agent.addRequest === module.Agent.prototype.addRequest &&
      agent.createSocket === module.Agent.prototype.createSocket &&
      SAFE_CONNECTORS.has(agent.createConnection)
  );
  if (
    options.agent !== undefined &&
    options.agent !== null &&
    options.agent !== false &&
    !isCanonicalAgent(options.agent)
  ) {
    block('EXTERNAL_NETWORK_REQUEST', target, channel);
  }
  if (
    owns(options, '_defaultAgent') &&
    !isCanonicalAgent(options._defaultAgent)
  ) {
    block('EXTERNAL_NETWORK_REQUEST', target, channel);
  }
}

function guardParsedSocket(args, channel, protocol = 'tcp:') {
  let parsed = null;
  try {
    parsed = parsedSocketRequest(args, protocol);
  } catch {
    block('EXTERNAL_NETWORK_REQUEST', new URL(`${protocol}//unparseable.invalid:0/`), channel);
  }
  if (parsed !== null) {
    const kind = classify(parsed);
    if (kind) block(kind, parsed, channel);
  }
  return parsed;
}

function guardTls(args) {
  let parsed = null;
  try {
    parsed = parsedTlsRequest(args);
  } catch {
    block('EXTERNAL_NETWORK_REQUEST', new URL('tls://unparseable.invalid:0/'), 'TLS');
  }
  if (parsed !== null) {
    const kind = classify(parsed);
    if (kind) block(kind, parsed, 'TLS');
  }
  return parsed;
}

function guardDatagramSend(args) {
  let parsed = null;
  try {
    parsed = parsedDatagramSend(args);
  } catch {
    block('EXTERNAL_NETWORK_REQUEST', new URL('udp://unparseable.invalid:0/'), 'UDP');
  }
  if (parsed !== null) {
    const kind = classify(parsed);
    if (kind) block(kind, parsed, 'UDP');
  }
}

function installRequestTripwire(module, channel, defaultProtocol) {
  const originalRequest = module.request.bind(module);
  patchValue(module, 'request', (...args) => {
    const parsed = guardParsedRequest(args[0], args[1], channel, defaultProtocol);
    guardOpaqueRequestConnector(parsed, module, channel);
    return originalRequest(...args);
  });
  patchValue(module, 'get', (...args) => {
    const request = module.request(...args);
    request.end();
    return request;
  });

  const OriginalClientRequest = module.ClientRequest;
  if (typeof OriginalClientRequest === 'function') {
    const GuardedClientRequest = new Proxy(OriginalClientRequest, {
      construct(target, args, newTarget) {
        const parsed = guardParsedRequest(args[0], args[1], channel, defaultProtocol);
        guardOpaqueRequestConnector(parsed, module, channel);
        return Reflect.construct(target, args, newTarget);
      },
    });
    patchValue(module, 'ClientRequest', GuardedClientRequest);
    patchValue(OriginalClientRequest.prototype, 'constructor', GuardedClientRequest);
  }

  const originalAgentConnect = module.Agent.prototype.createConnection;
  function guardedAgentConnection(...args) {
    guardParsedSocket(args, channel, channel === 'HTTPS' ? 'tls:' : 'tcp:');
    return originalAgentConnect.apply(this, args);
  }
  SAFE_CONNECTORS.add(guardedAgentConnection);
  patchValue(module.Agent.prototype, 'createConnection', guardedAgentConnection);
}

function installHttp2Tripwire() {
  const originalConnect = http2.connect.bind(http2);
  patchValue(http2, 'connect', (authority, options, listener) => {
    const parsed = guardParsedRequest(authority, options, 'HTTP2', 'https:');
    if (strict && typeof options?.createConnection === 'function') {
      block('EXTERNAL_NETWORK_REQUEST', parsed.url ?? new URL('https://unparseable.invalid/'), 'HTTP2');
    }
    return originalConnect(authority, options, listener);
  });
}

function installSocketTripwire() {
  const originalSocketConnect = net.Socket.prototype.connect;
  patchValue(net.Socket.prototype, 'connect', function guardedSocketConnect(...args) {
    guardParsedSocket(args, 'TCP');
    return originalSocketConnect.apply(this, args);
  });

  const originalCreateConnection = net.createConnection.bind(net);
  const guardedCreateConnection = (...args) => {
    guardParsedSocket(args, 'TCP');
    return originalCreateConnection(...args);
  };
  SAFE_CONNECTORS.add(guardedCreateConnection);
  patchValue(net, 'createConnection', guardedCreateConnection);
  patchValue(net, 'connect', guardedCreateConnection);

  const originalTlsConnect = tls.connect.bind(tls);
  const guardedTlsConnect = (...args) => {
    guardTls(args);
    return originalTlsConnect(...args);
  };
  SAFE_CONNECTORS.add(guardedTlsConnect);
  patchValue(tls, 'connect', guardedTlsConnect);

  const originalTlsSocketConnect = tls.TLSSocket.prototype.connect;
  patchValue(tls.TLSSocket.prototype, 'connect', function guardedTlsSocketConnect(...args) {
    guardTls(args);
    return originalTlsSocketConnect.apply(this, args);
  });

  const originalDatagramConnect = dgram.Socket.prototype.connect;
  patchValue(dgram.Socket.prototype, 'connect', function guardedDatagramConnect(...args) {
    guardParsedSocket(args, 'UDP', 'udp:');
    return originalDatagramConnect.apply(this, args);
  });

  const originalDatagramSend = dgram.Socket.prototype.send;
  patchValue(dgram.Socket.prototype, 'send', function guardedDatagramSend(...args) {
    guardDatagramSend(args);
    return originalDatagramSend.apply(this, args);
  });

  const originalDatagramSendTo = dgram.Socket.prototype.sendto;
  if (typeof originalDatagramSendTo === 'function') {
    patchValue(dgram.Socket.prototype, 'sendto', function guardedDatagramSendTo(...args) {
      guardDatagramSend(args);
      return originalDatagramSendTo.apply(this, args);
    });
  }
}

function installDnsTripwire() {
  const methodNames = new Set([
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
  ]);
  const targets = new Set([dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]);
  for (const target of targets) {
    for (const name of Object.getOwnPropertyNames(target)) {
      if (/^(?:lookup|resolve|reverse)/u.test(name)) methodNames.add(name);
    }
  }

  for (const target of targets) {
    for (const method of methodNames) {
      const original = target?.[method];
      if (typeof original !== 'function') continue;
      patchValue(target, method, function guardedDnsOperation(...args) {
        const hostname = args[0];
        const allowNumericLookup = method === 'lookup' &&
          isExactLoopbackAddress(hostname);
        if (!allowNumericLookup) {
          let parsed;
          try {
            parsed = networkUrl(
              'dns:',
              typeof hostname === 'string' && hostname.length > 0 ? hostname : 'unparseable.invalid',
            );
          } catch {
            block(
              'EXTERNAL_NETWORK_REQUEST',
              new URL('dns://unparseable.invalid:0/'),
              'DNS',
            );
          }
          block(classify(parsed) ?? 'EXTERNAL_NETWORK_REQUEST', parsed, 'DNS');
        }
        return original.apply(this, args);
      });
    }
  }
}

function installGlobalConstructor(
  name,
  channel,
  { optional = false, denyEveryConstruction = false, dispatcherKey = false } = {},
) {
  const Original = globalThis[name];
  if (typeof Original !== 'function') {
    if (optional) return;
    throw new TypeError(`required global ${name} is unavailable`);
  }
  const Guarded = new Proxy(Original, {
    construct(target, args, newTarget) {
      const parsed = parsedRequest(args[0], args[1]);
      if (parsed === null || parsed.url === null) {
        block('EXTERNAL_NETWORK_REQUEST', new URL('https://unparseable.invalid/'), channel);
      }
      const classification = classify(parsed.url, parsed.headers);
      if (denyEveryConstruction || classification !== null) {
        block(classification ?? 'EXTERNAL_NETWORK_REQUEST', parsed.url, channel);
      }
      if (
        strict && dispatcherKey &&
        args.some((value, index) => index > 0 && isOptions(value) && value.dispatcher !== undefined)
      ) {
        block('EXTERNAL_NETWORK_REQUEST', parsed.url, channel);
      }
      return Reflect.construct(target, args, newTarget);
    },
  });
  patchValue(globalThis, name, Guarded);
  patchValue(Original.prototype, 'constructor', Guarded);
}

function installWorkerTripwire() {
  const OriginalWorker = workerThreads.Worker;
  if (typeof OriginalWorker !== 'function') {
    throw new TypeError('required worker_threads.Worker surface is unavailable');
  }
  const GuardedWorker = new Proxy(OriginalWorker, {
    construct(target, args, newTarget) {
      const filename = args[0];
      const supplied = isOptions(args[1]) ? args[1] : {};
      if (strict && supplied.eval === true) {
        block('EXTERNAL_NETWORK_REQUEST', new URL('worker://eval'), 'WORKER');
      }
      if (
        supplied.env === workerThreads.SHARE_ENV ||
        (supplied.env !== undefined && !isOptions(supplied.env))
      ) {
        block('EXTERNAL_NETWORK_REQUEST', new URL('worker://environment'), 'WORKER');
      }

      const requestedExecArgv = Array.isArray(supplied.execArgv)
        ? [...supplied.execArgv]
        : [...process.execArgv];
      const execArgv = [];
      for (let index = 0; index < requestedExecArgv.length; index++) {
        const value = requestedExecArgv[index];
        if (typeof value !== 'string') {
          block('EXTERNAL_NETWORK_REQUEST', new URL('worker://exec-argv'), 'WORKER');
        }
        if (value === '--import') {
          if (requestedExecArgv[index + 1] !== import.meta.url) {
            block('EXTERNAL_NETWORK_REQUEST', new URL('worker://exec-argv'), 'WORKER');
          }
          index += 1;
          continue;
        }
        if (value.startsWith('--import=')) {
          if (value !== TRIPWIRE_IMPORT_OPTION) {
            block('EXTERNAL_NETWORK_REQUEST', new URL('worker://exec-argv'), 'WORKER');
          }
          continue;
        }
        if (
          value === '--require' || value.startsWith('--require=') ||
          (value.startsWith('-r') && !value.startsWith('--')) ||
          value === '--loader' || value.startsWith('--loader=') ||
          value === '--experimental-loader' || value.startsWith('--experimental-loader=')
        ) {
          block('EXTERNAL_NETWORK_REQUEST', new URL('worker://exec-argv'), 'WORKER');
        }
        execArgv.push(value);
      }
      execArgv.push(TRIPWIRE_IMPORT_OPTION);

      const env = {
        ...(isOptions(supplied.env) ? supplied.env : process.env),
        ...(strict ? { [STRICT_ENV]: '1' } : {}),
        ...(reportPath === null ? {} : { [REPORT_ENV]: reportPath }),
      };
      args[0] = filename;
      args[1] = { ...supplied, execArgv, env };
      return Reflect.construct(target, args, newTarget);
    },
  });
  patchValue(workerThreads, 'Worker', GuardedWorker);
  patchValue(OriginalWorker.prototype, 'constructor', GuardedWorker);
}

function install() {
  const originalFetch = globalThis.fetch.bind(globalThis);
  patchValue(globalThis, 'fetch', (input, init) => {
    try {
      const parsed = guardParsedRequest(input, init, 'FETCH', 'https:');
      if (strict && isOptions(init) && init.dispatcher !== undefined) {
        block('EXTERNAL_NETWORK_REQUEST', parsed.url, 'FETCH');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return originalFetch(input, { ...init, redirect: 'error' });
  });

  installGlobalConstructor('WebSocket', 'WEBSOCKET', { dispatcherKey: true });
  installGlobalConstructor('EventSource', 'EVENTSOURCE', {
    optional: true,
    denyEveryConstruction: true,
  });
  installRequestTripwire(http, 'HTTP', 'http:');
  installRequestTripwire(https, 'HTTPS', 'https:');
  installHttp2Tripwire();
  installSocketTripwire();
  installDnsTripwire();
  installWorkerTripwire();
  syncBuiltinESMExports();
}

if (!globalThis[INSTALL_KEY]) {
  install();
  globalThis[INSTALL_KEY] = Object.freeze({ strict, reportPath });
  report({ kind: 'INSTALL' });
  process.on('beforeExit', latchFailure);
  process.on('exit', latchFailure);
}
