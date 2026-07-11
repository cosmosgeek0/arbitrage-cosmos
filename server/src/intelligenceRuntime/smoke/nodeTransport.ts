import WebSocket, {
  type ClientOptions,
  type RawData,
} from 'ws';
import type {
  ManualSmokeReporter,
  PublicRestRequest,
  PublicRestResponse,
  PublicRestTransport,
  PublicWebSocketConnectRequest,
  PublicWebSocketConnection,
  PublicWebSocketTransport,
  RuntimeClock,
} from '../contracts/index.js';
import type { SmokeWaitPort } from './types.js';

const REST_ALLOWLIST = Object.freeze(new Map([
  ['https://data-api.binance.vision', new Set(['/api/v3/exchangeInfo'])],
  ['https://fapi.binance.com', new Set(['/fapi/v1/exchangeInfo'])],
]));

const EXACT_WEB_SOCKET_URLS = Object.freeze(new Set([
  'wss://stream.binance.com:9443/ws/!miniTicker@arr',
  'wss://fstream.binance.com/public/ws/!bookTicker',
  'wss://fstream.binance.com/market/ws/!markPrice@arr@1s',
]));

const FOCUS_URL_PATTERN = /^wss:\/\/stream\.binance\.com:9443\/stream\?streams=([a-z0-9._-]{2,64})@aggTrade\/\1@bookTicker\/\1@depth@100ms$/;
const MAX_QUERY_PARAMETERS = 16;
const MAX_QUERY_BYTES = 4_096;
const MAX_HEADER_COUNT = 128;
const MAX_HEADER_LENGTH = 4_096;

function boundedInteger(value: number | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return resolved;
}

function safeNow(clock: RuntimeClock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Node public transport clock returned an invalid timestamp');
  return value;
}

function publicRestUrl(request: PublicRestRequest): string {
  if (request.method !== 'GET') throw new TypeError('manual smoke REST permits GET only');
  const paths = REST_ALLOWLIST.get(request.baseUrl);
  if (paths === undefined || !paths.has(request.path)) throw new TypeError('manual smoke REST endpoint is not on the keyless public allowlist');
  const entries = Object.entries(request.query);
  if (entries.length > MAX_QUERY_PARAMETERS) throw new RangeError('manual smoke REST query exceeds its parameter bound');
  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /(?:key|secret|signature|timestamp|recvWindow)/i.test(key)) {
      throw new TypeError('manual smoke REST query contains a forbidden parameter');
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError('manual smoke REST query value is invalid');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('manual smoke REST query number is not finite');
    query.set(key, String(value));
  }
  const encoded = query.toString();
  if (Buffer.byteLength(encoded, 'utf8') > MAX_QUERY_BYTES) throw new RangeError('manual smoke REST query exceeds its byte bound');
  return `${request.baseUrl}${request.path}${encoded.length > 0 ? `?${encoded}` : ''}`;
}

async function boundedResponseBody(response: Response, maximumBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel('manual smoke response byte bound exceeded');
      throw new RangeError('manual smoke REST response exceeds its byte bound');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (response.status >= 200 && response.status < 300) throw new TypeError('manual smoke REST success body is not valid JSON');
    return Object.freeze({ httpStatus: response.status, statusText: response.statusText, body: text.slice(0, 1_024) });
  }
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  let count = 0;
  for (const [name, value] of headers.entries()) {
    count += 1;
    if (count > MAX_HEADER_COUNT) throw new RangeError('manual smoke REST response has too many headers');
    if (name.length > 256 || value.length > MAX_HEADER_LENGTH) throw new RangeError('manual smoke REST response header exceeds its bound');
    output[name.toLowerCase()] = value;
  }
  return Object.freeze(output);
}

export interface NodePublicRestTransportOptions {
  readonly clock: RuntimeClock;
  readonly fetch?: typeof fetch;
  readonly maximumResponseBytes?: number;
  readonly maximumTimeoutMs?: number;
}

/** Explicitly constructed keyless Node REST adapter; never reads env or credentials. */
export class NodePublicRestTransport implements PublicRestTransport {
  readonly #clock: RuntimeClock;
  readonly #fetch: typeof fetch;
  readonly #maximumResponseBytes: number;
  readonly #maximumTimeoutMs: number;

  constructor(options: NodePublicRestTransportOptions) {
    if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('Node public REST clock is required');
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof fetchImplementation !== 'function') throw new TypeError('Node fetch implementation is required');
    this.#clock = options.clock;
    this.#fetch = fetchImplementation.bind(globalThis);
    this.#maximumResponseBytes = boundedInteger(options.maximumResponseBytes, 32 * 1024 * 1024, 'maximumResponseBytes', 1_024, 64 * 1024 * 1024);
    this.#maximumTimeoutMs = boundedInteger(options.maximumTimeoutMs, 30_000, 'maximumTimeoutMs', 100, 60_000);
  }

  async request<T = unknown>(request: PublicRestRequest): Promise<PublicRestResponse<T>> {
    const url = publicRestUrl(request);
    const timeoutMs = boundedInteger(request.timeoutMs, request.timeoutMs, 'request timeoutMs', 100, this.#maximumTimeoutMs);
    const maximumResponseBytes = boundedInteger(
      request.maximumResponseBytes,
      request.maximumResponseBytes,
      'request maximumResponseBytes',
      1_024,
      this.#maximumResponseBytes,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      const body = await boundedResponseBody(response, maximumResponseBytes) as T;
      return Object.freeze({
        status: response.status,
        headers: responseHeaders(response.headers),
        body,
        receiveTimeMs: safeNow(this.#clock),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isAllowedPublicSmokeWebSocketUrl(url: string): boolean {
  return EXACT_WEB_SOCKET_URLS.has(url) || FOCUS_URL_PATTERN.test(url);
}

type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export interface NodePublicWebSocketTransportOptions {
  readonly clock: RuntimeClock;
  readonly socketFactory?: SocketFactory;
  readonly maximumConnections?: number;
  readonly maximumMessageBytes?: number;
  readonly handshakeTimeoutMs?: number;
}

function rawBytes(data: RawData): Buffer {
  if (Array.isArray(data)) {
    const total = data.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    return Buffer.concat(data, total);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * One-shot, non-reconnecting, keyless Node WebSocket adapter. It allows only
 * the current documented public smoke routes and retains no message history.
 */
export class NodePublicWebSocketTransport implements PublicWebSocketTransport {
  readonly #clock: RuntimeClock;
  readonly #socketFactory: SocketFactory;
  readonly #maximumConnections: number;
  readonly #maximumMessageBytes: number;
  readonly #handshakeTimeoutMs: number;
  readonly #active = new Set<WebSocket>();

  constructor(options: NodePublicWebSocketTransportOptions) {
    if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('Node public WebSocket clock is required');
    this.#clock = options.clock;
    this.#socketFactory = options.socketFactory ?? ((url, socketOptions) => new WebSocket(url, socketOptions));
    this.#maximumConnections = boundedInteger(options.maximumConnections, 4, 'maximumConnections', 1, 8);
    this.#maximumMessageBytes = boundedInteger(options.maximumMessageBytes, 2 * 1024 * 1024, 'maximumMessageBytes', 1_024, 16 * 1024 * 1024);
    this.#handshakeTimeoutMs = boundedInteger(options.handshakeTimeoutMs, 10_000, 'handshakeTimeoutMs', 100, 60_000);
  }

  get activeConnectionCount(): number {
    return this.#active.size;
  }

  connect(request: PublicWebSocketConnectRequest): PublicWebSocketConnection {
    if (!isAllowedPublicSmokeWebSocketUrl(request.url)) throw new TypeError('manual smoke WebSocket URL is not on the public allowlist');
    if (!Number.isSafeInteger(request.generation) || request.generation < 1) throw new TypeError('manual smoke WebSocket generation is invalid');
    if (typeof request.onEvent !== 'function') throw new TypeError('manual smoke WebSocket event callback is required');
    if (this.#active.size >= this.#maximumConnections) throw new RangeError('manual smoke WebSocket connection bound reached');
    const maximumMessageBytes = boundedInteger(
      request.maximumMessageBytes,
      request.maximumMessageBytes,
      'request maximumMessageBytes',
      1_024,
      this.#maximumMessageBytes,
    );
    const socket = this.#socketFactory(request.url, {
      handshakeTimeout: this.#handshakeTimeoutMs,
      maxPayload: maximumMessageBytes,
      perMessageDeflate: false,
      followRedirects: false,
      headers: { 'User-Agent': 'Main-Public-No-Key-Smoke/1' },
    });
    this.#active.add(socket);
    const emit = (event: Parameters<PublicWebSocketConnectRequest['onEvent']>[0]): void => {
      try { request.onEvent(event); } catch { /* transport callbacks cannot tear down the socket emitter */ }
    };
    socket.on('open', () => emit({ kind: 'OPEN', receiveTimeMs: safeNow(this.#clock) }));
    socket.on('message', (data: RawData, isBinary: boolean) => {
      const receiveTimeMs = safeNow(this.#clock);
      if (isBinary) {
        emit({ kind: 'ERROR', receiveTimeMs, code: 'BINARY_MESSAGE_REJECTED', message: 'manual public smoke accepts JSON text only' });
        return;
      }
      try {
        const bytes = rawBytes(data);
        if (bytes.byteLength > maximumMessageBytes) throw new RangeError('public WebSocket message exceeds its byte bound');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        emit({ kind: 'MESSAGE', receiveTimeMs, data: value });
      } catch (error) {
        emit({
          kind: 'ERROR',
          receiveTimeMs,
          code: 'INVALID_PUBLIC_MESSAGE',
          message: error instanceof Error ? error.message.slice(0, 512) : 'invalid public JSON message',
        });
      }
    });
    socket.on('ping', (payload) => emit({ kind: 'PING', receiveTimeMs: safeNow(this.#clock), payload: payload.byteLength === 0 ? null : payload.toString('base64').slice(0, 512) }));
    socket.on('pong', (payload) => emit({ kind: 'PONG', receiveTimeMs: safeNow(this.#clock), payload: payload.byteLength === 0 ? null : payload.toString('base64').slice(0, 512) }));
    socket.on('error', (error) => emit({
      kind: 'ERROR',
      receiveTimeMs: safeNow(this.#clock),
      code: 'NETWORK_ERROR',
      message: error.message.slice(0, 512),
    }));
    socket.on('unexpected-response', (_request, response) => {
      emit({
        kind: 'ERROR',
        receiveTimeMs: safeNow(this.#clock),
        code: `HTTP_${response.statusCode ?? 'UNKNOWN'}`,
        message: `public WebSocket handshake returned HTTP ${response.statusCode ?? 'unknown'}`,
      });
      response.resume();
      socket.terminate();
    });
    socket.on('close', (code, reason) => {
      this.#active.delete(socket);
      emit({
        kind: 'CLOSE',
        receiveTimeMs: safeNow(this.#clock),
        code,
        reason: reason.toString('utf8').slice(0, 512),
      });
    });

    return Object.freeze({
      send(): void {
        throw new Error('manual public smoke uses URL-bound raw streams and does not send client messages');
      },
      close(code = 1000, reason = 'manual public smoke shutdown'): void {
        if (!Number.isInteger(code) || code < 1_000 || code > 4_999) throw new TypeError('WebSocket close code is invalid');
        const boundedReason = reason.slice(0, 123);
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else if (socket.readyState === WebSocket.OPEN) socket.close(code, boundedReason);
      },
    });
  }
}

export class SystemSmokeClock implements RuntimeClock {
  nowMs(): number { return Date.now(); }
}

export class NodeSmokeWait implements SmokeWaitPort {
  wait(delayMs: number): Promise<void> {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 5 * 60_000) {
      return Promise.reject(new RangeError('manual smoke wait is outside its bound'));
    }
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export class ConsoleSmokeReporter implements ManualSmokeReporter {
  report(entry: Parameters<ManualSmokeReporter['report']>[0]): void {
    console.log(JSON.stringify({ type: 'public-no-key-smoke-step', ...entry }));
  }
}
