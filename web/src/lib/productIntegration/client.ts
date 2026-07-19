import {
  PRODUCT_COMMAND_SCHEMA,
  type MaterialEventPage,
  type ProductCommandResultIdentity,
  type ProductCommandResultReadback,
  type ProductCommandRequest,
  type ProductControlPreview,
  type ProductControlResult,
  type ProductCorrelationTrace,
  type ProductSupervisorEnvelope,
  isProductCommandResultIdentity,
  validateMaterialEventPage,
  validateProductCorrelationTrace,
  validateProductSupervisorEnvelope,
} from './model';
import { deriveProductCommandResultIdentity } from './commandIdentity';
import { isCanonicalProductControlResult } from './controlResultValidation';

export interface ProductCommandResultTransportResponse {
  readonly httpStatus: number;
  readonly body: unknown;
}

export interface ProductIntegrationTransport {
  readSupervisor(signal?: AbortSignal): Promise<unknown>;
  readMaterialEvents(afterCursor: string, limit: number, signal?: AbortSignal): Promise<unknown>;
  readTrace(correlationId: string, limit: number, signal?: AbortSignal): Promise<unknown>;
  readCommandResult(
    identity: Readonly<ProductCommandResultIdentity>,
    signal?: AbortSignal,
  ): Promise<Readonly<ProductCommandResultTransportResponse>>;
  previewCommand(controlId: string, expectedRevision: string, targetId?: string, signal?: AbortSignal): Promise<unknown>;
  submitCommand(request: Readonly<ProductCommandRequest>, signal?: AbortSignal): Promise<unknown>;
}

export interface ProductIntegrationClient {
  readSupervisor<TDashboard = unknown>(signal?: AbortSignal): Promise<ProductSupervisorEnvelope<TDashboard>>;
  readMaterialEvents(afterCursor: string, limit?: number, signal?: AbortSignal): Promise<MaterialEventPage>;
  readTrace(correlationId: string, limit?: number, signal?: AbortSignal): Promise<ProductCorrelationTrace>;
  readCommandResult(identity: Readonly<ProductCommandResultIdentity>, signal?: AbortSignal): Promise<ProductCommandResultReadback>;
  previewCommand(controlId: string, expectedRevision: string, targetId?: string, signal?: AbortSignal): Promise<ProductControlPreview>;
  submitCommand(request: Readonly<ProductCommandRequest>, signal?: AbortSignal): Promise<ProductControlResult>;
}

export class ProductBindingError extends Error {
  readonly codes: readonly string[];

  constructor(message: string, codes: readonly string[]) {
    super(message);
    this.name = 'ProductBindingError';
    this.codes = Object.freeze([...codes]);
  }
}

export function createProductIntegrationClient(
  transport: Readonly<ProductIntegrationTransport>,
): ProductIntegrationClient {
  return Object.freeze({
    async readSupervisor<TDashboard = unknown>(signal?: AbortSignal) {
      const value = await transport.readSupervisor(signal);
      const errors = validateProductSupervisorEnvelope(value);
      if (errors.length) throw new ProductBindingError('Canonical product supervisor validation failed.', errors);
      return value as ProductSupervisorEnvelope<TDashboard>;
    },

    async readMaterialEvents(afterCursor: string, limit = 200, signal?: AbortSignal) {
      const boundedLimit = boundedQueryLimit(limit);
      const value = await transport.readMaterialEvents(afterCursor, boundedLimit, signal);
      const page = value as MaterialEventPage;
      const errors = validateMaterialEventPage(afterCursor, page, 'CURSOR');
      if (errors.length) throw new ProductBindingError('Material-event continuity is not proven.', errors);
      return page;
    },

    async readTrace(correlationId: string, limit = 200, signal?: AbortSignal) {
      if (!/^[A-Za-z0-9_.:\-]{1,160}$/.test(correlationId)) {
        throw new ProductBindingError('Correlation id is invalid.', ['TRACE_CORRELATION_ID_INVALID']);
      }
      const value = await transport.readTrace(correlationId, boundedQueryLimit(limit), signal);
      const errors = validateProductCorrelationTrace(value, correlationId);
      if (errors.length) throw new ProductBindingError('Trace response is invalid.', errors);
      return value as unknown as ProductCorrelationTrace;
    },

    async readCommandResult(identity: Readonly<ProductCommandResultIdentity>, signal?: AbortSignal) {
      if (!isProductCommandResultIdentity(identity)) {
        throw new ProductBindingError('Command-result identity is invalid.', ['COMMAND_RESULT_IDENTITY_INVALID']);
      }
      const expectedIdentity = await deriveProductCommandResultIdentity(identity.idempotencyKey, identity.controlId);
      if (expectedIdentity.commandId !== identity.commandId) {
        throw new ProductBindingError('Command-result identity is not canonical.', ['COMMAND_RESULT_IDENTITY_INVALID']);
      }
      const response = await transport.readCommandResult(identity, signal);
      if (!isRecord(response)
        || Object.keys(response).length !== 2
        || !Number.isSafeInteger(response.httpStatus)
        || !Object.hasOwn(response, 'body')) {
        throw new ProductBindingError('Command-result transport response is invalid.', ['COMMAND_RESULT_TRANSPORT_INVALID']);
      }
      const value = response.body;
      if (response.httpStatus === 503 && isCanonicalCommandResultFailure(value)) {
        throw new ProductBindingError(value.error, [value.code]);
      }
      if (!isRecord(value)
        || value.commandId !== identity.commandId
        || value.controlId !== identity.controlId) {
        throw new ProductBindingError('Command-result identity does not match the durable query.', ['COMMAND_RESULT_IDENTITY_MISMATCH']);
      }
      if (!isCanonicalProductControlResult(value, identity, {
        allowSynthetic: false,
        allowedStatuses: ['APPLIED', 'ACCEPTED_ASYNC', 'ALREADY_APPLIED', 'FAILED_ATTENTION_REQUIRED'],
      })) {
        throw new ProductBindingError('Command-result response is invalid.', ['COMMAND_RESULT_INVALID']);
      }
      const state = response.httpStatus === 202 && value.status === 'ACCEPTED_ASYNC'
        ? 'PENDING' as const
        : response.httpStatus === 200 && (value.status === 'APPLIED' || value.status === 'ALREADY_APPLIED')
          ? 'TERMINAL' as const
          : response.httpStatus === 503 && value.status === 'FAILED_ATTENTION_REQUIRED'
            ? 'AMBIGUOUS' as const
            : null;
      if (state === null) {
        throw new ProductBindingError('Command-result HTTP status and body disagree.', ['COMMAND_RESULT_HTTP_STATUS_MISMATCH']);
      }
      const result = Object.freeze({ ...value }) as unknown as ProductControlResult;
      return state === 'AMBIGUOUS'
        ? Object.freeze({ state, result, reasonCode: 'COMMAND_RESULT_FAILED_ATTENTION_REQUIRED' as const })
        : Object.freeze({ state, result, reasonCode: null });
    },

    async previewCommand(controlId: string, expectedRevision: string, targetId?: string, signal?: AbortSignal) {
      if (!controlId || !expectedRevision
        || (targetId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(targetId))) {
        throw new ProductBindingError('Control preview identity is incomplete.', ['CONTROL_PREVIEW_IDENTITY_INCOMPLETE']);
      }
      const value = await transport.previewCommand(controlId, expectedRevision, targetId, signal);
      if (!isRecord(value)
        || value.controlId !== controlId
        || value.expectedRevision !== expectedRevision
        || typeof value.previewId !== 'string'
        || typeof value.digest !== 'string'
        || typeof value.consequence !== 'string'
        || typeof value.synthetic !== 'boolean'
        || typeof value.expiresAtMs !== 'number'
        || !Number.isFinite(value.expiresAtMs)
        || value.expiresAtMs <= Date.now()) {
        throw new ProductBindingError('Control preview response is invalid.', ['CONTROL_PREVIEW_INVALID']);
      }
      return value as unknown as ProductControlPreview;
    },

    async submitCommand(request: Readonly<ProductCommandRequest>, signal?: AbortSignal) {
      if (request.schemaVersion !== PRODUCT_COMMAND_SCHEMA) {
        throw new ProductBindingError('Command schema is unsupported.', ['CONTROL_COMMAND_SCHEMA_UNSUPPORTED']);
      }
      const identityFields = [request.idempotencyKey, request.controlId, request.backendCommandId, request.targetType,
        request.targetId, request.currentRevision, request.expectedRevision, request.previewId, request.previewDigest, request.reason];
      if (identityFields.some((field) => typeof field !== 'string' || field.length === 0 || field.length > 500)
        || !isCommandPayload(request.payload)
        || !Number.isFinite(request.expiresAtMs)
        || request.expiresAtMs <= Date.now()) {
        throw new ProductBindingError('Command authority fields are invalid or expired.', ['CONTROL_COMMAND_INVALID']);
      }
      const expectedIdentity = await deriveProductCommandResultIdentity(request.idempotencyKey, request.controlId);
      const value = await transport.submitCommand(request, signal);
      if (!isCanonicalProductControlResult(value, expectedIdentity, { allowSynthetic: true })) {
        throw new ProductBindingError('Control result response is invalid.', ['CONTROL_RESULT_INVALID']);
      }
      return value as unknown as ProductControlResult;
    },
  });
}

function boundedQueryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ProductBindingError('Query limit must be an integer from 1 through 500.', ['QUERY_LIMIT_OUT_OF_BOUNDS']);
  }
  return limit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalCommandResultFailure(
  value: unknown,
): value is Readonly<{ ok: false; code: string; error: string }> {
  return isRecord(value)
    && Object.keys(value).length === 3
    && value.ok === false
    && typeof value.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(value.code)
    && typeof value.error === 'string'
    && value.error.length > 0
    && value.error.length <= 500;
}

function isCommandPayload(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length <= 20 && Object.values(value).every((entry) => (
    entry === null || typeof entry === 'string' || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
  ));
}
