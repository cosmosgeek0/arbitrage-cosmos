import {
  PRODUCT_COMMAND_SCHEMA,
  type MaterialEventPage,
  type ProductCommandRequest,
  type ProductControlPreview,
  type ProductControlResult,
  type ProductCorrelationTrace,
  type ProductSupervisorEnvelope,
  validateMaterialEventPage,
  validateProductCorrelationTrace,
  validateProductSupervisorEnvelope,
} from './model';

export interface ProductIntegrationTransport {
  readSupervisor(signal?: AbortSignal): Promise<unknown>;
  readMaterialEvents(afterCursor: string, limit: number, signal?: AbortSignal): Promise<unknown>;
  readTrace(correlationId: string, limit: number, signal?: AbortSignal): Promise<unknown>;
  previewCommand(controlId: string, expectedRevision: string, signal?: AbortSignal): Promise<unknown>;
  submitCommand(request: Readonly<ProductCommandRequest>, signal?: AbortSignal): Promise<unknown>;
}

export interface ProductIntegrationClient {
  readSupervisor<TDashboard = unknown>(signal?: AbortSignal): Promise<ProductSupervisorEnvelope<TDashboard>>;
  readMaterialEvents(afterCursor: string, limit?: number, signal?: AbortSignal): Promise<MaterialEventPage>;
  readTrace(correlationId: string, limit?: number, signal?: AbortSignal): Promise<ProductCorrelationTrace>;
  previewCommand(controlId: string, expectedRevision: string, signal?: AbortSignal): Promise<ProductControlPreview>;
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

    async previewCommand(controlId: string, expectedRevision: string, signal?: AbortSignal) {
      if (!controlId || !expectedRevision) {
        throw new ProductBindingError('Control preview identity is incomplete.', ['CONTROL_PREVIEW_IDENTITY_INCOMPLETE']);
      }
      const value = await transport.previewCommand(controlId, expectedRevision, signal);
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
      const value = await transport.submitCommand(request, signal);
      const durableReceiptRequired = isRecord(value) && ['APPLIED', 'ACCEPTED_ASYNC', 'ALREADY_APPLIED'].includes(String(value.status));
      if (!isRecord(value)
        || value.controlId !== request.controlId
        || !CONTROL_RESULT_STATUSES.has(String(value.status))
        || typeof value.commandId !== 'string' || value.commandId.length === 0
        || typeof value.before !== 'string'
        || typeof value.after !== 'string'
        || !(value.receiptId === null || typeof value.receiptId === 'string')
        || (durableReceiptRequired && (typeof value.receiptId !== 'string' || value.receiptId.length === 0))
        || typeof value.correlationId !== 'string' || value.correlationId.length === 0
        || typeof value.completedAtMs !== 'number' || !Number.isFinite(value.completedAtMs)
        || typeof value.synthetic !== 'boolean') {
        throw new ProductBindingError('Control result response is invalid.', ['CONTROL_RESULT_INVALID']);
      }
      return value as unknown as ProductControlResult;
    },
  });
}

const CONTROL_RESULT_STATUSES = new Set([
  'APPLIED', 'ACCEPTED_ASYNC', 'REJECTED_SCHEMA', 'REJECTED_BOUNDS', 'REJECTED_AUTHORITY',
  'REJECTED_STALE_REVISION', 'REJECTED_STATE', 'REJECTED_DEPENDENCY', 'REJECTED_EXPOSURE',
  'REJECTED_NOT_SUPPORTED', 'EXPIRED', 'ALREADY_APPLIED', 'FAILED_RECOVERABLE',
  'FAILED_ATTENTION_REQUIRED',
]);

function boundedQueryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ProductBindingError('Query limit must be an integer from 1 through 500.', ['QUERY_LIMIT_OUT_OF_BOUNDS']);
  }
  return limit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandPayload(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length <= 20 && Object.values(value).every((entry) => (
    entry === null || typeof entry === 'string' || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
  ));
}
