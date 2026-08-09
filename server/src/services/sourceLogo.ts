import { deterministicOfflinePublicSourcesEnabled } from '../binance/publicSourceMode.js';

const SOURCE_LOGO_TTL_MS = 24 * 60 * 60 * 1_000;
const SOURCE_LOGO_MAX_BYTES = 256 * 1_024;
const SOURCE_LOGO_CACHE_MAX = 256;
const SOURCE_LOGO_FAILURE_TTL_MS = 60_000;
const SOURCE_LOGO_TIMEOUT_MS = 5_000;
const DIRECT_SOURCE_LOGOS: Readonly<Record<string, string>> = Object.freeze({
  'financialjuice.com': 'https://www.financialjuice.com/favicon.ico',
});

export type SourceLogoEntry = Readonly<{
  ts: number;
  contentType: string;
  body: Buffer;
}>;

export type SourceLogoLifecycleContext = Readonly<{
  cacheScope: string;
  generation: number;
  signal: AbortSignal;
}>;

export type SourceLogoSourceSnapshot = Readonly<{
  providerCalls: number;
  inFlight: number;
  cached: number;
  failures: number;
}>;

type SourceLogoSourceOptions = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => number;
}>;

function lifecycleKey(
  domain: string,
  size: number,
  lifecycle: SourceLogoLifecycleContext,
): string {
  return `${lifecycle.cacheScope}:${lifecycle.generation}:${domain}:${size}`;
}

function abortReason(lifecycle: SourceLogoLifecycleContext): Error {
  return lifecycle.signal.reason instanceof Error
    ? lifecycle.signal.reason
    : new DOMException('source logo lifecycle aborted', 'AbortError');
}

function assertLifecycleActive(lifecycle: SourceLogoLifecycleContext): void {
  if (lifecycle.signal.aborted) throw abortReason(lifecycle);
}

async function readBoundedImage(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > SOURCE_LOGO_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('upstream payload is too large');
  }
  if (!response.body) throw new Error('upstream payload is empty');

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SOURCE_LOGO_MAX_BYTES) {
        await reader.cancel('payload limit exceeded').catch(() => undefined);
        throw new Error('upstream payload is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('upstream payload is empty');
  return Buffer.concat(chunks, total);
}

function sourceLogoType(body: Buffer): string | null {
  if (body.length >= 8
      && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'image/jpeg';
  }
  if (body.length >= 12
      && body.toString('ascii', 0, 4) === 'RIFF'
      && body.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return 'image/x-icon';
  }
  return null;
}

export function createSourceLogoSource(options: SourceLogoSourceOptions = {}): Readonly<{
  cached: (
    domain: string,
    size: number,
    lifecycle: SourceLogoLifecycleContext,
  ) => SourceLogoEntry | null;
  load: (
    domain: string,
    size: number,
    lifecycle: SourceLogoLifecycleContext,
  ) => Promise<SourceLogoEntry>;
  snapshot: () => SourceLogoSourceSnapshot;
}> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, SourceLogoEntry>();
  const failures = new Map<string, number>();
  const inFlight = new Map<string, Promise<SourceLogoEntry>>();
  let providerCalls = 0;

  const cached = (
    domain: string,
    size: number,
    lifecycle: SourceLogoLifecycleContext,
  ): SourceLogoEntry | null => {
    assertLifecycleActive(lifecycle);
    const key = `${domain}:${size}`;
    const entry = cache.get(key);
    if (!entry) return null;
    if (now() - entry.ts >= SOURCE_LOGO_TTL_MS) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    assertLifecycleActive(lifecycle);
    return entry;
  };

  const remember = (key: string, entry: SourceLogoEntry): void => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > SOURCE_LOGO_CACHE_MAX) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const load = (
    domain: string,
    size: number,
    lifecycle: SourceLogoLifecycleContext,
  ): Promise<SourceLogoEntry> => {
    if (deterministicOfflinePublicSourcesEnabled()) {
      return Promise.reject(new Error('source logo unavailable'));
    }
    assertLifecycleActive(lifecycle);
    const key = `${domain}:${size}`;
    const hit = cached(domain, size, lifecycle);
    if (hit) return Promise.resolve(hit);
    const failedAt = failures.get(key) ?? 0;
    if (now() - failedAt < SOURCE_LOGO_FAILURE_TTL_MS) {
      return Promise.reject(new Error('source logo is cooling down'));
    }

    const requestKey = lifecycleKey(domain, size, lifecycle);
    const existing = inFlight.get(requestKey);
    if (existing) return existing;

    const request = (async (): Promise<SourceLogoEntry> => {
      const controller = new AbortController();
      const abortForLifecycle = () => controller.abort(lifecycle.signal.reason);
      lifecycle.signal.addEventListener('abort', abortForLifecycle, { once: true });
      const timer = setTimeout(
        () => controller.abort(new DOMException('source logo timed out', 'TimeoutError')),
        SOURCE_LOGO_TIMEOUT_MS,
      );
      try {
        assertLifecycleActive(lifecycle);
        const faviconUrl = DIRECT_SOURCE_LOGOS[domain]
          ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
        providerCalls += 1;
        const upstream = await fetchImpl(faviconUrl, {
          headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/x-icon,*/*;q=0.5' },
          signal: controller.signal,
          redirect: 'error',
        });
        assertLifecycleActive(lifecycle);
        if (!upstream.ok) throw new Error(`favicon HTTP ${upstream.status}`);
        const body = await readBoundedImage(upstream);
        assertLifecycleActive(lifecycle);
        const contentType = sourceLogoType(body);
        if (!contentType) throw new Error('unsupported favicon payload');
        const entry = Object.freeze({ ts: now(), contentType, body });
        assertLifecycleActive(lifecycle);
        remember(key, entry);
        failures.delete(key);
        return entry;
      } catch (error) {
        if (lifecycle.signal.aborted) throw abortReason(lifecycle);
        failures.set(key, now());
        while (failures.size > SOURCE_LOGO_CACHE_MAX) {
          const oldest = failures.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          failures.delete(oldest);
        }
        throw error;
      } finally {
        clearTimeout(timer);
        lifecycle.signal.removeEventListener('abort', abortForLifecycle);
      }
    })().finally(() => {
      if (inFlight.get(requestKey) === request) inFlight.delete(requestKey);
    });
    inFlight.set(requestKey, request);
    return request;
  };

  return Object.freeze({
    cached,
    load,
    snapshot: () => Object.freeze({
      providerCalls,
      inFlight: inFlight.size,
      cached: cache.size,
      failures: failures.size,
    }),
  });
}
