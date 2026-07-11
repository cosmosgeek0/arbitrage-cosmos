import type { BinanceUsdMError, BinanceUsdMTransportRequest } from './types.js';

const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_MARKER = /(?:secret|token|password|credential|api[-_]?key|signature|authorization)/i;

function parameterNames(encoded: string): readonly string[] {
  const names = encoded.length === 0
    ? []
    : encoded.split('&').map((part) => {
        const raw = part.split('=', 1)[0];
        try {
          return decodeURIComponent(raw);
        } catch {
          return 'MALFORMED_PARAMETER_NAME';
        }
      });
  return Object.freeze([...new Set(names)].sort());
}

/** Never exposes API keys, signatures, or order/account parameter values. */
export function serializeSafeRequest(request: BinanceUsdMTransportRequest): string {
  const names = [...parameterNames(request.query), ...parameterNames(request.body ?? '')];
  const view = {
    operation: request.operation,
    method: request.method,
    path: request.path,
    idempotent: request.idempotent,
    timeoutMs: request.timeoutMs,
    hasAbortSignal: request.signal !== undefined,
    authentication: Object.keys(request.headers).length > 0 ? 'REDACTED' : 'NONE',
    parameterNames: [...new Set(names)].sort(),
  };
  return JSON.stringify(view);
}

/** Deterministic, bounded, credential-free error serialization. */
export function serializeSafeError(error: BinanceUsdMError): string {
  const correlationId = SAFE_CORRELATION_ID.test(error.correlationId) && !SENSITIVE_MARKER.test(error.correlationId)
    ? error.correlationId
    : '[REDACTED]';
  return JSON.stringify({
    component: error.component,
    stage: error.stage,
    kind: error.kind,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ambiguous: error.ambiguous,
    transportOutcome: error.transportOutcome,
    httpStatus: error.httpStatus,
    venueCode: error.venueCode,
    venueMessage: error.venueMessage === null ? null : '[REDACTED]',
    occurredAt: error.occurredAt,
    safeCurrentState: error.safeCurrentState,
    correlationId,
    recommendedOperatorAction: error.recommendedOperatorAction,
  });
}
