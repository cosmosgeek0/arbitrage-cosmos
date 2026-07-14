import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const sentinelPath = process.env.PRIVATE_EGRESS_SENTINEL_FILE;

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
  const host = url.hostname.toLowerCase();
  if (host === 'ws-api.binance.com') return 'BINANCE_PRIVATE_STREAM';
  if (url.searchParams.has('signature') || headersContainPrivateAuthority(headers)) return 'SIGNED_OR_AUTHENTICATED_REQUEST';
  if (host === '169.254.169.254' || host === '169.254.170.2' || host.endsWith('.amazonaws.com')) return 'AWS_REQUEST';
  return null;
}

function block(kind, url) {
  if (sentinelPath) appendFileSync(sentinelPath, `${kind} ${url.hostname}${url.pathname}\n`, 'utf8');
  throw new Error(`PROHIBITED_PRIVATE_EGRESS:${kind}`);
}

function parsedRequest(input, options) {
  try {
    if (typeof input === 'string' || input instanceof URL) {
      return { url: new URL(input), headers: options?.headers };
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

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const kind = classify(url, init?.headers ?? (typeof input === 'object' ? input.headers : undefined));
  if (kind) return Promise.reject(block(kind, url));
  return originalFetch(input, init);
};

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

installRequestTripwire(http);
installRequestTripwire(https);
