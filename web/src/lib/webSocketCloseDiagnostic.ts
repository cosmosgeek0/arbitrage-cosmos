export const WEB_SOCKET_CLOSE_DIAGNOSTIC_ID = 'i00-ws-close-diagnostic';

const MAX_CLOSE_REASON_BYTES = 123;
const MAX_RECONNECT_GENERATION = 1_000_000;

export type WebSocketCloseDiagnostic = Readonly<{
  code: number;
  reason: string;
  wasClean: boolean;
  reconnectGeneration: number;
}>;

export type WebSocketCloseDiagnosticAttributes = Readonly<Record<string, string>>;

/**
 * Snapshot only a browser-originated CloseEvent from the live WebSocket.
 * Script-created events are untrusted and therefore cannot manufacture
 * restart evidence. Invalid or unbounded input removes evidence instead of
 * supplying defaults.
 */
export function snapshotTrustedWebSocketCloseEvent(
  event: Event,
  reconnectGeneration: number,
): WebSocketCloseDiagnostic | null {
  if (typeof CloseEvent === 'undefined'
      || !(event instanceof CloseEvent)
      || event.type !== 'close'
      || event.isTrusted !== true
      || !Number.isInteger(event.code)
      || event.code < 1_000
      || event.code > 4_999
      || typeof event.reason !== 'string'
      || typeof event.wasClean !== 'boolean'
      || !Number.isSafeInteger(reconnectGeneration)
      || reconnectGeneration < 1
      || reconnectGeneration > MAX_RECONNECT_GENERATION) return null;

  try {
    if (new TextEncoder().encode(event.reason).byteLength > MAX_CLOSE_REASON_BYTES) return null;
  } catch {
    return null;
  }

  return Object.freeze({
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
    reconnectGeneration,
  });
}

/**
 * A failed connection attempt can emit a trusted 1006 CloseEvent without ever
 * reaching `open`. It is transport-attempt truth, but it must not erase the
 * last established socket's close evidence. Once a socket has opened, its
 * close always becomes authoritative; malformed evidence therefore clears the
 * prior diagnostic instead of preserving a stale success claim.
 */
export function reduceTrustedWebSocketCloseDiagnostic(
  current: WebSocketCloseDiagnostic | null,
  event: Event,
  reconnectGeneration: number,
  connectionEstablished: boolean,
): WebSocketCloseDiagnostic | null {
  if (connectionEstablished !== true) return current;
  return snapshotTrustedWebSocketCloseEvent(event, reconnectGeneration);
}

export function webSocketCloseDiagnosticAttributes(
  diagnostic: WebSocketCloseDiagnostic | null,
): WebSocketCloseDiagnosticAttributes {
  if (diagnostic === null) {
    return Object.freeze({ 'data-i00-ws-close-status': 'UNAVAILABLE' });
  }
  return Object.freeze({
    'data-i00-ws-close-status': 'OBSERVED',
    'data-i00-ws-close-code': String(diagnostic.code),
    'data-i00-ws-close-reason': diagnostic.reason,
    'data-i00-ws-close-was-clean': String(diagnostic.wasClean),
    'data-i00-ws-close-generation': String(diagnostic.reconnectGeneration),
  });
}
