import { buildProductRuntimeControlRegistry, parseProductRuntimeCommandRequest, previewProductRuntimeControl, submitProductRuntimeControl } from './controls.js';
import { isProductRuntimeCursor, isProductRuntimeRowCursor, projectProductMaterialEventPage } from './events.js';
import { buildProductRuntimeSupervisorEnvelope } from './projection.js';
import { isProductRuntimeTraceId, projectProductCorrelationTrace } from './trace.js';
import {
  PRODUCT_RUNTIME_MAX_QUERY_LIMIT,
  ProductRuntimeError,
  type ProductRuntimeCommandRequest,
  type ProductRuntimeControlPreview,
  type ProductRuntimeControlResult,
  type ProductRuntimeCorrelationTrace,
  type ProductRuntimeMaterialEventPage,
  type ProductRuntimeOperator,
  type ProductRuntimeOptions,
  type ProductRuntimeSupervisorEnvelope,
} from './types.js';

function checkedNow(options: Readonly<ProductRuntimeOptions>): number {
  const nowMs = options.clock.nowMs();
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new ProductRuntimeError('CLOCK_INVALID', 'Injected runtime clock returned invalid UTC milliseconds.', 503);
  return nowMs;
}

export class ProductIntegrationRuntimeService {
  private readonly options: Readonly<ProductRuntimeOptions>;

  constructor(options: Readonly<ProductRuntimeOptions>) {
    if (!options || typeof options.read?.supervisor !== 'function' || typeof options.read?.events !== 'function'
        || typeof options.read?.trace !== 'function' || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('ProductIntegrationRuntimeService requires injected supervisor, events, traces, and clock ports.');
    }
    this.options = options;
  }

  private async readSupervisorMaterialTail(): Promise<Readonly<ProductRuntimeMaterialEventPage>> {
    const geometry = await this.options.read.events({ afterCursor: '0', limit: 1 });
    if (!geometry || !isProductRuntimeCursor(geometry.highWaterCursor)) {
      return projectProductMaterialEventPage('0', 1, geometry, 'TAIL_BOOTSTRAP');
    }
    const highWater = BigInt(geometry.highWaterCursor);
    const tailWindowStart = highWater > BigInt(PRODUCT_RUNTIME_MAX_QUERY_LIMIT)
      ? highWater - BigInt(PRODUCT_RUNTIME_MAX_QUERY_LIMIT)
      : 0n;
    const retainedStart = geometry.retainedFromCursor !== null
      && isProductRuntimeRowCursor(geometry.retainedFromCursor)
      && BigInt(geometry.retainedFromCursor) <= highWater
      ? BigInt(geometry.retainedFromCursor) - 1n
      : 0n;
    const after = tailWindowStart > retainedStart ? tailWindowStart : retainedStart;
    const afterCursor = after.toString();
    const source = await this.options.read.events({
      afterCursor,
      limit: PRODUCT_RUNTIME_MAX_QUERY_LIMIT,
    });
    return projectProductMaterialEventPage(
      afterCursor,
      PRODUCT_RUNTIME_MAX_QUERY_LIMIT,
      source,
      'TAIL_BOOTSTRAP',
    );
  }

  async readSupervisor(): Promise<Readonly<ProductRuntimeSupervisorEnvelope>> {
    const nowMs = checkedNow(this.options);
    try {
      const snapshot = await this.options.read.supervisor();
      const materialEvents = await this.readSupervisorMaterialTail();
      const correlationIds = [...new Set(snapshot.recentCorrelatedDecisions.map((event) => event.correlationId))].slice(0, 4);
      const traces: Readonly<ProductRuntimeCorrelationTrace>[] = [];
      for (const correlationId of correlationIds) {
        const sourceTrace = await this.options.read.trace(correlationId, 200);
        if (sourceTrace) {
          if (sourceTrace.events.length > 200) {
            throw new ProductRuntimeError('TRACE_SOURCE_INVALID', 'Trace owner exceeded the requested bound.', 503);
          }
          traces.push(projectProductCorrelationTrace(correlationId, sourceTrace));
        }
      }
      return buildProductRuntimeSupervisorEnvelope({
        snapshot,
        materialEvents,
        traces: Object.freeze(traces),
        nowMs,
        ...(this.options.commandOwner ? { commandOwner: this.options.commandOwner } : {}),
      });
    } catch (error) {
      if (error instanceof ProductRuntimeError) throw error;
      throw new ProductRuntimeError('PRODUCT_READ_MODEL_UNAVAILABLE', 'Canonical System Integration read evidence is unavailable.', 503);
    }
  }

  async readMaterialEvents(afterCursor: string, limit: number): Promise<Readonly<ProductRuntimeMaterialEventPage>> {
    if (!isProductRuntimeCursor(afterCursor)) {
      throw new ProductRuntimeError('INVALID_MATERIAL_CURSOR', 'afterCursor must be a SQLite row-id cursor.', 400);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > PRODUCT_RUNTIME_MAX_QUERY_LIMIT) {
      throw new ProductRuntimeError('QUERY_LIMIT_OUT_OF_BOUNDS', 'limit must be an integer from 1 through 500.', 400);
    }
    try {
      const source = await this.options.read.events({ afterCursor, limit });
      return projectProductMaterialEventPage(afterCursor, limit, source, 'CURSOR');
    } catch (error) {
      if (error instanceof ProductRuntimeError) throw error;
      throw new ProductRuntimeError('MATERIAL_EVENT_OWNER_UNAVAILABLE', 'Canonical material-event evidence is unavailable.', 503);
    }
  }

  async readTrace(correlationId: string, limit: number): Promise<Readonly<ProductRuntimeCorrelationTrace> | null> {
    if (!isProductRuntimeTraceId(correlationId)) throw new ProductRuntimeError('INVALID_TRACE_ID', 'correlationId is invalid.', 400);
    if (!Number.isInteger(limit) || limit < 1 || limit > PRODUCT_RUNTIME_MAX_QUERY_LIMIT) {
      throw new ProductRuntimeError('QUERY_LIMIT_OUT_OF_BOUNDS', 'limit must be an integer from 1 through 500.', 400);
    }
    try {
      const trace = await this.options.read.trace(correlationId, limit);
      if (!trace) return null;
      if (trace.events.length > limit) throw new ProductRuntimeError('TRACE_SOURCE_INVALID', 'Trace owner exceeded the requested bound.', 503);
      return projectProductCorrelationTrace(correlationId, trace);
    } catch (error) {
      if (error instanceof ProductRuntimeError) throw error;
      throw new ProductRuntimeError('TRACE_OWNER_UNAVAILABLE', 'Canonical trace evidence is unavailable.', 503);
    }
  }

  async previewCommand(input: Readonly<{
    controlId: string;
    expectedRevision: string;
    operator: Readonly<ProductRuntimeOperator>;
  }>): Promise<Readonly<ProductRuntimeControlPreview>> {
    const nowMs = checkedNow(this.options);
    let snapshot;
    try { snapshot = await this.options.read.supervisor(); } catch {
      throw new ProductRuntimeError('PRODUCT_READ_MODEL_UNAVAILABLE', 'Canonical System Integration read evidence is unavailable.', 503);
    }
    const registry = buildProductRuntimeControlRegistry(snapshot, this.options.commandOwner);
    return previewProductRuntimeControl({
      registry,
      owner: this.options.commandOwner,
      controlId: input.controlId,
      expectedRevision: input.expectedRevision,
      nowMs,
      operator: input.operator,
    });
  }

  async submitCommand(value: unknown, operator: Readonly<ProductRuntimeOperator>): Promise<Readonly<ProductRuntimeControlResult>> {
    const request: Readonly<ProductRuntimeCommandRequest> = parseProductRuntimeCommandRequest(value);
    const nowMs = checkedNow(this.options);
    let snapshot;
    try { snapshot = await this.options.read.supervisor(); } catch {
      throw new ProductRuntimeError('PRODUCT_READ_MODEL_UNAVAILABLE', 'Canonical System Integration read evidence is unavailable.', 503);
    }
    const registry = buildProductRuntimeControlRegistry(snapshot, this.options.commandOwner);
    return submitProductRuntimeControl({ registry, owner: this.options.commandOwner, request, nowMs, operator });
  }
}

export function createProductIntegrationRuntime(options: Readonly<ProductRuntimeOptions>): ProductIntegrationRuntimeService {
  return new ProductIntegrationRuntimeService(options);
}
