import { createHash } from 'node:crypto';

import {
  buildProductRuntimeControlRegistry,
  parseProductRuntimeCommandRequest,
  previewProductRuntimeControl,
  productIncidentAcknowledgementControlId,
  submitProductRuntimeControl,
} from './controls.js';
import { isProductRuntimeCursor, isProductRuntimeRowCursor, projectProductMaterialEventPage } from './events.js';
import { buildProductRuntimeSupervisorEnvelope } from './projection.js';
import { isProductRuntimeTraceId, projectProductCorrelationTrace } from './trace.js';
import { evaluateCanonicalOpsIntakeGate } from '../../systemIntegration/ops/index.js';
import type { BootReleaseReadback } from '../../systemIntegration/persistence/index.js';
import { traceByCorrelationId } from '../../systemIntegration/supervisor/index.js';
import {
  PRODUCT_RUNTIME_MAX_QUERY_LIMIT,
  PRODUCT_RUNTIME_COMMAND_SCHEMA,
  ProductRuntimeError,
  type ProductRuntimeCommandRequest,
  type ProductRuntimeCommandResultIdentity,
  type ProductRuntimeCommandResultReadback,
  type ProductRuntimeControlPreview,
  type ProductRuntimeControlResult,
  type ProductRuntimeCorrelationTrace,
  type ProductRuntimeMaterialEventPage,
  type ProductRuntimeOperator,
  type ProductRuntimeOptions,
  type ProductRuntimeOwnerTruthCut,
  type ProductRuntimeOwnerTruthUnavailableReason,
  type ProductRuntimeIncidentSnapshot,
  type ProductRuntimeSupervisorEnvelope,
} from './types.js';

function checkedNow(options: Readonly<ProductRuntimeOptions>): number {
  const nowMs = options.clock.nowMs();
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new ProductRuntimeError('CLOCK_INVALID', 'Injected runtime clock returned invalid UTC milliseconds.', 503);
  return nowMs;
}

const PRODUCT_SUPERVISOR_EMBEDDED_TRACE_LIMIT = 200;
const PRODUCT_SUPERVISOR_SHARED_READ_TTL_MS = 1_000;

function incidentTargetForControl(controlId: string, targetId: unknown): string | undefined {
  const incidentControl = /^incident\.ack\.[a-f0-9]{64}$/.test(controlId);
  if (!incidentControl) {
    if (targetId !== undefined) {
      throw new ProductRuntimeError('CONTROL_PREVIEW_INVALID', 'targetId is only accepted for an incident-bound control.', 400);
    }
    return undefined;
  }
  if (typeof targetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(targetId)
    || productIncidentAcknowledgementControlId(targetId) !== controlId) {
    throw new ProductRuntimeError('CONTROL_PREVIEW_INVALID', 'Incident targetId does not match the bound control identity.', 400);
  }
  return targetId;
}

async function requireAvailableIncidentCommandTarget(
  options: Readonly<ProductRuntimeOptions>,
  incidentId: string,
  controlId: string,
  expectedRevision: string,
): Promise<void> {
  if (typeof options.read.incidents !== 'function') {
    throw new ProductRuntimeError(
      'INCIDENT_ROUTER_UNAVAILABLE',
      'The canonical incident router is not configured for acknowledgement commands.',
      503,
    );
  }
  let snapshot: Readonly<ProductRuntimeIncidentSnapshot>;
  try { snapshot = await options.read.incidents(); } catch {
    throw new ProductRuntimeError(
      'INCIDENT_ROUTER_UNAVAILABLE',
      'The canonical incident router could not provide a verified command cut.',
      503,
    );
  }
  const matches = Array.isArray(snapshot?.incidents)
    ? snapshot.incidents.filter((incident) => incident?.incidentId === incidentId)
    : [];
  const incident = matches[0];
  if (!snapshot || snapshot.availability?.state !== 'AVAILABLE'
    || snapshot.availability.truthLabel !== 'BUILT_AND_TESTED'
    || snapshot.availability.blocker !== null
    || !Array.isArray(snapshot.incidents) || snapshot.incidents.length > 200
    || matches.length !== 1 || !incident
    || incident.acknowledgementControlId !== controlId
    || productIncidentAcknowledgementControlId(incidentId) !== controlId
    || !Number.isSafeInteger(incident.ledgerEventId) || incident.ledgerEventId < 1
    || incident.state !== 'OPEN'
    || incident.acknowledgedAtMs !== null
    || incident.acknowledgedByOperatorId !== null
    || incident.resolvedAtMs !== null
    || incident.routing?.inApp?.state !== 'WIRED_LOCAL') {
    throw new ProductRuntimeError(
      'INCIDENT_COMMAND_TRUTH_UNAVAILABLE',
      'The incident is absent, stale, non-open, or withheld from the verified canonical router cut.',
      409,
    );
  }
  if (String(incident.ledgerEventId) !== expectedRevision) {
    throw new ProductRuntimeError(
      'REJECTED_STALE_REVISION',
      'The incident acknowledgement revision is stale against the verified canonical router cut.',
      409,
    );
  }
}

function commandResultIdentity(
  idempotencyKey: string,
  controlId: string,
): Readonly<ProductRuntimeCommandResultIdentity> {
  const canonical = `{"controlId":${JSON.stringify(controlId)},"idempotencyKey":${JSON.stringify(idempotencyKey)},"schema":${JSON.stringify(PRODUCT_RUNTIME_COMMAND_SCHEMA)}}`;
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return Object.freeze({ commandId: `sysctrl_${digest}`, idempotencyKey, controlId });
}

async function isExactTerminalCommandReplay(
  options: Readonly<ProductRuntimeOptions>,
  request: Readonly<ProductRuntimeCommandRequest>,
): Promise<boolean> {
  if (typeof options.commandOwner?.readResult !== 'function') return false;
  const identity = commandResultIdentity(request.idempotencyKey, request.controlId);
  try {
    const readback = await options.commandOwner.readResult(identity);
    return readback?.state === 'TERMINAL'
      && readback.result !== null
      && readback.failureCode === null
      && readback.result.commandId === identity.commandId
      && readback.result.controlId === identity.controlId
      && ['APPLIED', 'ALREADY_APPLIED'].includes(readback.result.status);
  } catch {
    return false;
  }
}

export class ProductIntegrationRuntimeService {
  private readonly options: Readonly<ProductRuntimeOptions>;
  private sharedSupervisorRead: Readonly<{
    envelope: Readonly<ProductRuntimeSupervisorEnvelope>;
    publishedAtMs: number;
  }> | null = null;
  private sharedSupervisorInFlight: Promise<Readonly<ProductRuntimeSupervisorEnvelope>> | null = null;

  constructor(options: Readonly<ProductRuntimeOptions>) {
    if (!options || typeof options.read?.applicationStartOk !== 'function'
        || typeof options.read?.supervisor !== 'function' || typeof options.read?.opsReadback !== 'function'
        || typeof options.read?.events !== 'function'
        || typeof options.read?.trace !== 'function' || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('ProductIntegrationRuntimeService requires injected application-start, supervisor, ops readback, events, traces, and clock ports.');
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

  /**
   * Coalesced transport read for browser polling. The canonical fresh builder
   * remains available to command/internal owners through readSupervisor(); the
   * HTTP surface shares one immutable envelope for a bounded second so many
   * signed-in tabs cannot rebuild the same synchronous read graph in parallel.
   */
  readSupervisorShared(): Promise<Readonly<ProductRuntimeSupervisorEnvelope>> {
    if (this.sharedSupervisorInFlight !== null) return this.sharedSupervisorInFlight;
    const nowMs = checkedNow(this.options);
    const sharedAgeMs = this.sharedSupervisorRead === null
      ? null
      : nowMs - this.sharedSupervisorRead.publishedAtMs;
    if (this.sharedSupervisorRead !== null
        && sharedAgeMs !== null
        && sharedAgeMs >= 0
        && sharedAgeMs < PRODUCT_SUPERVISOR_SHARED_READ_TTL_MS) {
      return Promise.resolve(this.sharedSupervisorRead.envelope);
    }
    const work = this.readSupervisor()
      .then((envelope) => {
        this.sharedSupervisorRead = Object.freeze({
          envelope,
          publishedAtMs: envelope.evaluatedAtMs,
        });
        return envelope;
      })
      .finally(() => {
        if (this.sharedSupervisorInFlight === work) this.sharedSupervisorInFlight = null;
      });
    this.sharedSupervisorInFlight = work;
    return work;
  }

  /**
   * Non-building socket projection source. Delivery may announce the
   * last HTTP-published cut, but must never trigger another full Product read.
   */
  readPublishedSupervisor(): Readonly<ProductRuntimeSupervisorEnvelope> | null {
    return this.sharedSupervisorRead?.envelope ?? null;
  }

  async readSupervisor(): Promise<Readonly<ProductRuntimeSupervisorEnvelope>> {
    try {
      const applicationStartOk = await this.options.read.applicationStartOk();
      if (typeof applicationStartOk !== 'boolean') {
        throw new ProductRuntimeError(
          'APPLICATION_START_STATE_INVALID',
          'Canonical application-start evidence is malformed.',
          503,
        );
      }
      const applicationStartFailureCodes = typeof this.options.read.applicationStartFailureCodes === 'function'
        ? await this.options.read.applicationStartFailureCodes()
        : Object.freeze([]);
      if (!Array.isArray(applicationStartFailureCodes)
          || applicationStartFailureCodes.some((code) => (
            typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(code)
          ))) {
        throw new ProductRuntimeError(
          'APPLICATION_START_STATE_INVALID',
          'Canonical application-start failure evidence is malformed.',
          503,
        );
      }
      const snapshot = await this.options.read.supervisor();
      const opsReadback = await this.options.read.opsReadback(snapshot);
      let bootReleaseReadback: Readonly<BootReleaseReadback> | null = null;
      let bootReleaseReadbackUnavailableReason: 'BOOT_RELEASE_READBACK_NOT_CONFIGURED'
        | 'BOOT_RELEASE_READBACK_UNAVAILABLE'
        | null = typeof this.options.read.bootReleaseReadback === 'function'
          ? null
          : 'BOOT_RELEASE_READBACK_NOT_CONFIGURED';
      if (typeof this.options.read.bootReleaseReadback === 'function') {
        try {
          bootReleaseReadback = (await this.options.read.bootReleaseReadback()) ?? null;
        } catch {
          // Crash/release history remains explicit even when its canonical
          // owner cannot be read. The projection withholds revision values.
          bootReleaseReadback = null;
          bootReleaseReadbackUnavailableReason = 'BOOT_RELEASE_READBACK_UNAVAILABLE';
        }
      }
      let incidentSnapshot: Readonly<ProductRuntimeIncidentSnapshot> | undefined;
      if (typeof this.options.read.incidents === 'function') {
        try {
          incidentSnapshot = await this.options.read.incidents();
        } catch {
          incidentSnapshot = Object.freeze({
            availability: Object.freeze({
              state: 'UNAVAILABLE',
              truthLabel: 'UNAVAILABLE',
              blocker: 'INCIDENT_OWNER_UNAVAILABLE',
            }),
            incidents: Object.freeze([]),
          });
        }
      }
      const ownerTruthWired = typeof this.options.read.ownerTruth === 'function';
      let ownerTruthCut: Readonly<ProductRuntimeOwnerTruthCut> | null = null;
      let ownerTruthUnavailableReason: ProductRuntimeOwnerTruthUnavailableReason | null = null;
      if (typeof this.options.read.ownerTruth === 'function') {
        try {
          // Exactly one owner-truth read per envelope. Re-reading the port
          // would let a later account cut land beside an earlier market row in
          // the same immutable envelope.
          ownerTruthCut = (await this.options.read.ownerTruth(snapshot)) ?? null;
        } catch {
          // Private-account and market owner truth stays explicit when its
          // owner cannot answer. The projection withholds every bound row.
          ownerTruthCut = null;
          ownerTruthUnavailableReason = 'OWNER_TRUTH_OWNER_UNAVAILABLE';
        }
        if (ownerTruthCut === null && ownerTruthUnavailableReason === null) {
          ownerTruthUnavailableReason = 'OWNER_TRUTH_CUT_NOT_CONFIGURED';
        }
      }
      const materialEvents = await this.readSupervisorMaterialTail();
      const correlationIds = [...new Set(snapshot.recentCorrelatedDecisions.map((event) => event.correlationId))].slice(0, 4);
      const traces: Readonly<ProductRuntimeCorrelationTrace>[] = [];
      for (const correlationId of correlationIds) {
        // The supervisor already carries the canonical bounded trace index.
        // Re-reading the trace port would rebuild System truth and could mix a
        // later trace cut into this envelope.
        const indexedTrace = traceByCorrelationId(snapshot.traceIndex, correlationId);
        if (indexedTrace) {
          const selectedEvents = indexedTrace.events.slice(-PRODUCT_SUPERVISOR_EMBEDDED_TRACE_LIMIT);
          const sourceTrace = Object.freeze({
            ...indexedTrace,
            events: Object.freeze(selectedEvents),
            truncated: indexedTrace.truncated || selectedEvents.length < indexedTrace.events.length,
          });
          traces.push(projectProductCorrelationTrace(correlationId, sourceTrace));
        }
      }
      const nowMs = checkedNow(this.options);
      const opsIntakeInterlock = evaluateCanonicalOpsIntakeGate(opsReadback, nowMs);
      if (opsIntakeInterlock.reasonCodes.some((code) => (
        code === 'CANONICAL_OPS_READBACK_INVALID'
        || code === 'CANONICAL_OPS_READBACK_NOT_CURRENT'
      ))) {
        throw new ProductRuntimeError(
          'OPS_READBACK_UNAVAILABLE',
          'Canonical operations readback is malformed, stale, or unavailable.',
          503,
        );
      }
      return buildProductRuntimeSupervisorEnvelope({
        applicationStartOk,
        applicationStartFailureCodes: Object.freeze([...applicationStartFailureCodes]),
        snapshot,
        opsReadback,
        opsIntakeInterlock,
        bootReleaseReadback,
        bootReleaseReadbackUnavailableReason,
        materialEvents,
        traces: Object.freeze(traces),
        ...(incidentSnapshot === undefined ? {} : { incidentSnapshot }),
        ...(ownerTruthWired ? { ownerTruthCut, ownerTruthUnavailableReason } : {}),
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
    targetId?: string;
    operator: Readonly<ProductRuntimeOperator>;
  }>): Promise<Readonly<ProductRuntimeControlPreview>> {
    const nowMs = checkedNow(this.options);
    const incidentId = incidentTargetForControl(input.controlId, input.targetId);
    let snapshot;
    try { snapshot = await this.options.read.supervisor(); } catch {
      throw new ProductRuntimeError('PRODUCT_READ_MODEL_UNAVAILABLE', 'Canonical System Integration read evidence is unavailable.', 503);
    }
    if (incidentId !== undefined) {
      await requireAvailableIncidentCommandTarget(
        this.options,
        incidentId,
        input.controlId,
        input.expectedRevision,
      );
    }
    const registry = buildProductRuntimeControlRegistry(
      snapshot,
      this.options.commandOwner,
      input.controlId,
      incidentId,
    );
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
    const incidentId = /^incident\.ack\.[a-f0-9]{64}$/.test(request.controlId)
      ? incidentTargetForControl(request.controlId, request.targetId)
      : undefined;
    let snapshot;
    try { snapshot = await this.options.read.supervisor(); } catch {
      throw new ProductRuntimeError('PRODUCT_READ_MODEL_UNAVAILABLE', 'Canonical System Integration read evidence is unavailable.', 503);
    }
    if (incidentId !== undefined) {
      const exactReplay = await isExactTerminalCommandReplay(this.options, request);
      if (!exactReplay) {
        await requireAvailableIncidentCommandTarget(
          this.options,
          incidentId,
          request.controlId,
          request.expectedRevision,
        );
      }
    }
    const registry = buildProductRuntimeControlRegistry(
      snapshot,
      this.options.commandOwner,
      request.controlId,
      incidentId,
    );
    return submitProductRuntimeControl({ registry, owner: this.options.commandOwner, request, nowMs, operator });
  }

  async readCommandResult(
    identity: Readonly<ProductRuntimeCommandResultIdentity>,
  ): Promise<Readonly<ProductRuntimeCommandResultReadback>> {
    if (!this.options.commandOwner || typeof this.options.commandOwner.readResult !== 'function') {
      throw new ProductRuntimeError('COMMAND_RESULT_NOT_CONFIGURED', 'The canonical command-result owner is not configured.', 409);
    }
    let readback: Readonly<ProductRuntimeCommandResultReadback>;
    try {
      readback = await this.options.commandOwner.readResult(identity);
    } catch {
      throw new ProductRuntimeError('COMMAND_RESULT_OWNER_UNAVAILABLE', 'The canonical command-result owner is unavailable.', 503);
    }
    if (!readback || !['NOT_FOUND', 'PENDING', 'TERMINAL', 'FAIL_CLOSED'].includes(readback.state)
      || (readback.state === 'NOT_FOUND' && (readback.result !== null || readback.failureCode !== null))
      || (['PENDING', 'TERMINAL'].includes(readback.state) && (readback.result === null || readback.failureCode !== null))
      || (readback.state === 'FAIL_CLOSED'
        && (typeof readback.failureCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(readback.failureCode)))) {
      throw new ProductRuntimeError('COMMAND_RESULT_OWNER_INVALID', 'The canonical command-result owner returned invalid evidence.', 503);
    }
    return readback;
  }
}

export function createProductIntegrationRuntime(options: Readonly<ProductRuntimeOptions>): ProductIntegrationRuntimeService {
  return new ProductIntegrationRuntimeService(options);
}
