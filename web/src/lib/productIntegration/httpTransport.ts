import { fetchJson, fetchJsonResponse } from '../http';
import type { ProductIntegrationTransport } from './client';
import type { ProductCommandRequest, ProductCommandResultIdentity } from './model';

export interface ProductIntegrationEndpoints {
  readonly supervisor: string;
  readonly materialEvents: string;
  readonly trace: (correlationId: string) => string;
  readonly commandResult: (commandId: string) => string;
  readonly commandPreview: string;
  readonly commandSubmit: string;
}

/**
 * No endpoint is assumed here. The I00 director supplies the registered route
 * set after IP-RUNTIME freezes it, so this client cannot silently call a legacy
 * route that lacks cursor or command-registry guarantees.
 */
export function createHttpProductIntegrationTransport(
  endpoints: Readonly<ProductIntegrationEndpoints>,
): ProductIntegrationTransport {
  const supervisor = sameOriginPath(endpoints.supervisor);
  const materialEvents = sameOriginPath(endpoints.materialEvents);
  const commandPreview = sameOriginPath(endpoints.commandPreview);
  const commandSubmit = sameOriginPath(endpoints.commandSubmit);
  const transport: ProductIntegrationTransport = {
    readSupervisor(signal) {
      return fetchJson<unknown>(supervisor, { cache: 'no-store', credentials: 'same-origin', signal });
    },
    readMaterialEvents(afterCursor, limit, signal) {
      const url = new URL(materialEvents, window.location.origin);
      url.searchParams.set('afterCursor', afterCursor);
      url.searchParams.set('limit', String(limit));
      return fetchJson<unknown>(`${url.pathname}${url.search}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
    },
    readTrace(correlationId, limit, signal) {
      const url = new URL(sameOriginPath(endpoints.trace(correlationId)), window.location.origin);
      url.searchParams.set('limit', String(limit));
      return fetchJson<unknown>(`${url.pathname}${url.search}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      });
    },
    readCommandResult(identity: Readonly<ProductCommandResultIdentity>, signal) {
      const url = new URL(sameOriginPath(endpoints.commandResult(identity.commandId)), window.location.origin);
      url.searchParams.set('idempotencyKey', identity.idempotencyKey);
      url.searchParams.set('controlId', identity.controlId);
      return fetchJsonResponse<unknown>(
        `${url.pathname}${url.search}`,
        { cache: 'no-store', credentials: 'same-origin', signal },
        10_000,
        [503],
      ).then(({ status, body }) => Object.freeze({ httpStatus: status, body }));
    },
    previewCommand(controlId, expectedRevision, targetId, signal) {
      return fetchJson<unknown>(commandPreview, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controlId,
          expectedRevision,
          ...(targetId === undefined ? {} : { targetId }),
        }),
      });
    },
    submitCommand(request: Readonly<ProductCommandRequest>, signal) {
      return fetchJson<unknown>(commandSubmit, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    },
  };
  return Object.freeze(transport);
}

function sameOriginPath(value: string): string {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('PRODUCT_ENDPOINT_MUST_BE_SAME_ORIGIN');
  return `${url.pathname}${url.search}`;
}
