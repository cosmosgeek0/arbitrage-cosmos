export const WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD = 3;
export const WEB_SOCKET_PROTOCOL_MAX_ENVELOPE_BYTES = 1_048_576;

// Browsers permit application/private close codes in the 4xxx range. This
// reason is deliberately short enough to remain below the WebSocket 123-byte
// close-reason bound.
export const WEB_SOCKET_PROTOCOL_CLOSE_CODE = 4_002;
export const WEB_SOCKET_PROTOCOL_CLOSE_REASON = 'invalid server envelope';

export type WebSocketProtocolHealthStatus = 'CURRENT' | 'DEGRADED';

export type WebSocketProtocolHealth = Readonly<{
  status: WebSocketProtocolHealthStatus;
  failureCount: number;
  reconnectRequired: boolean;
}>;

export type WebSocketProtocolObservation = 'VALID_ENVELOPE' | 'INVALID_ENVELOPE';

export const INITIAL_WEB_SOCKET_PROTOCOL_HEALTH: WebSocketProtocolHealth = Object.freeze({
  status: 'CURRENT',
  failureCount: 0,
  reconnectRequired: false,
});

/**
 * Protocol violations immediately degrade browser-visible socket health and
 * remain evidence for the life of that connection. The counter saturates at
 * the reconnect threshold so an attacker or broken peer cannot grow client
 * state without bound. A newly opened connection owns the reset.
 */
export function reduceWebSocketProtocolHealth(
  current: Readonly<WebSocketProtocolHealth>,
  observation: WebSocketProtocolObservation,
): WebSocketProtocolHealth {
  if (observation === 'VALID_ENVELOPE') return current;

  const currentFailures = Number.isSafeInteger(current.failureCount)
    && current.failureCount >= 0
    && current.failureCount <= WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD
    ? current.failureCount
    : WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD;
  const failureCount = Math.min(
    WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD,
    currentFailures + 1,
  );
  return Object.freeze({
    status: 'DEGRADED',
    failureCount,
    reconnectRequired: failureCount >= WEB_SOCKET_PROTOCOL_FAILURE_THRESHOLD,
  });
}

export type DecodedWebSocketProtocolEnvelope =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; value: null }>;

const INVALID_DECODED_ENVELOPE: DecodedWebSocketProtocolEnvelope = Object.freeze({
  ok: false,
  value: null,
});

/**
 * Decode only bounded UTF-8 text that the caller's closed envelope validator
 * recognizes. Parser and validator failures are protocol failures, never
 * ignorable messages.
 */
export function decodeWebSocketProtocolEnvelope(
  raw: unknown,
  isKnownEnvelope: (value: unknown) => boolean,
): DecodedWebSocketProtocolEnvelope {
  if (typeof raw !== 'string') return INVALID_DECODED_ENVELOPE;
  try {
    const byteLength = new TextEncoder().encode(raw).byteLength;
    if (byteLength < 1 || byteLength > WEB_SOCKET_PROTOCOL_MAX_ENVELOPE_BYTES) {
      return INVALID_DECODED_ENVELOPE;
    }
    const value: unknown = JSON.parse(raw);
    if (!isKnownEnvelope(value)) return INVALID_DECODED_ENVELOPE;
    return Object.freeze({ ok: true, value });
  } catch {
    return INVALID_DECODED_ENVELOPE;
  }
}
