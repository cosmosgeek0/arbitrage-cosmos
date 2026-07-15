export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error implements ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiRequestError';
    this.status = failure.status;
    this.code = failure.code;
    this.details = failure.details;
  }
}

export interface JsonHttpResponse<T> {
  readonly status: number;
  readonly body: T;
}

function requestLabel(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function responseFailure(response: Response): Promise<ApiRequestError> {
  let payload: unknown = null;
  try {
    const text = await response.text();
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
  } catch {
    payload = null;
  }

  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const message = typeof record?.error === 'string'
    ? record.error
    : typeof record?.message === 'string'
      ? record.message
      : typeof payload === 'string' && payload.trim()
        ? payload.trim().slice(0, 240)
        : `Request failed with HTTP ${response.status}`;
  const code = typeof record?.code === 'string' && record.code.trim()
    ? record.code.trim()
    : `HTTP_${response.status}`;

  return new ApiRequestError({
    status: response.status,
    code,
    message,
    details: record?.fields ?? record?.issues,
  });
}

/**
 * Fetch a JSON response with one bounded request lifetime and retain its HTTP
 * status for callers whose domain state is status-bound. Non-2xx responses
 * reject unless the caller explicitly lists the status for strict body/status
 * validation at its own contract boundary.
 */
export async function fetchJsonResponse<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
  acceptedErrorStatuses: readonly number[] = [],
): Promise<Readonly<JsonHttpResponse<T>>> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(250, timeoutMs));

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
      throw await responseFailure(response);
    }
    if (response.status === 204) {
      return Object.freeze({ status: response.status, body: undefined as T });
    }
    try {
      return Object.freeze({ status: response.status, body: await response.json() as T });
    } catch {
      throw new ApiRequestError({
        status: 502,
        code: 'INVALID_JSON_RESPONSE',
        message: `Invalid JSON response from ${requestLabel(input)}`,
      });
    }
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError({
        status: 408,
        code: 'REQUEST_TIMEOUT',
        message: `Request timed out after ${Math.max(250, timeoutMs)}ms`,
      });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  return (await fetchJsonResponse<T>(input, init, timeoutMs)).body;
}

export function apiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiRequestError) return `${error.message} (${error.code})`;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
