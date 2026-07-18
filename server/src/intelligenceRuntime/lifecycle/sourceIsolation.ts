import { createHash } from 'node:crypto';

export const ISOLATABLE_PUBLIC_SOURCE_IDS = Object.freeze([
  'public-spot-source',
  'public-usdm-source',
] as const);
export type IsolatablePublicSourceId = (typeof ISOLATABLE_PUBLIC_SOURCE_IDS)[number];
export type SourceIsolationAction = 'ISOLATE' | 'RESTART';
export type SourceControlLifecycle = 'LIVE' | 'WARMING' | 'DEGRADED' | 'ISOLATED' | 'FAILED' | 'STOPPED';

export interface SourceControlPhysicalReadback {
  readonly lifecycle: SourceControlLifecycle;
  readonly generation: number;
}

export interface SourceIsolationSnapshot extends SourceControlPhysicalReadback {
  readonly sourceId: IsolatablePublicSourceId;
  readonly sourceRevision: number;
  readonly desiredLifecycle: 'LIVE' | 'ISOLATED';
  readonly observedLifecycle: SourceControlLifecycle;
}

interface SourceState {
  readonly sourceRevision: number;
  readonly desiredLifecycle: 'LIVE' | 'ISOLATED';
  readonly expectedPhysicalGeneration: number;
}

export interface SourceReceipt {
  readonly receiptId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly sourceId: IsolatablePublicSourceId;
  readonly action: SourceIsolationAction;
  readonly actor: Readonly<{ id: string; email: string | null; source: 'loopback' | 'cloudflare-access' }>;
  readonly reason: string;
  readonly requestedAtMs: number;
  readonly sourceRevision: number;
}

export interface SourceIsolationState {
  readonly schema: 'cosmos.source-isolation.v1';
  readonly revision: number;
  readonly sources: Readonly<Record<IsolatablePublicSourceId, Readonly<SourceState>>>;
  readonly receipts: readonly Readonly<SourceReceipt>[];
}

export interface SourceIsolationPersistencePort {
  load(): Readonly<SourceIsolationState> | null;
  compareAndSet(
    expected: Readonly<SourceIsolationState> | null,
    next: Readonly<SourceIsolationState>,
    audit: Readonly<SourceReceipt>,
  ): boolean;
}

export interface SourceIsolationPhysicalPort {
  read(sourceId: IsolatablePublicSourceId): Readonly<SourceControlPhysicalReadback>;
  isolate(sourceId: IsolatablePublicSourceId): void;
  restart(sourceId: IsolatablePublicSourceId): void;
}

export interface SourceIsolationRequest {
  readonly idempotencyKey: string;
  readonly sourceId: IsolatablePublicSourceId;
  readonly action: SourceIsolationAction;
  readonly expectedSourceRevision: number;
  readonly requestedAtMs: number;
  readonly reason: string;
  readonly actor: Readonly<{ id: string; email: string | null; source: 'loopback' | 'cloudflare-access' }>;
}

export type SourceIsolationResult =
  | Readonly<{
      ok: true;
      status: 'APPLIED' | 'ALREADY_APPLIED';
      receiptId: string;
      snapshot: Readonly<SourceIsolationSnapshot>;
    }>
  | Readonly<{ ok: false; code: string; receiptId?: string }>;

export interface SourceIsolationOwnerPort {
  canApply(sourceId: string, action: string, expectedSourceRevision: number): Readonly<{ ok: boolean; code: string }>;
  apply(request: Readonly<SourceIsolationRequest>): Promise<SourceIsolationResult>;
  snapshot(sourceId: IsolatablePublicSourceId): Readonly<SourceIsolationSnapshot>;
  readEffect(sourceId: IsolatablePublicSourceId): 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
}

export interface SourceIsolationOwnerOptions {
  readonly clock: { nowMs(): number };
  readonly persistence: SourceIsolationPersistencePort;
  readonly physical: SourceIsolationPhysicalPort;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
}

function validPhysical(value: unknown): value is Readonly<SourceControlPhysicalReadback> {
  return value !== null && typeof value === 'object'
    && ['LIVE', 'WARMING', 'DEGRADED', 'ISOLATED', 'FAILED', 'STOPPED'].includes(String((value as SourceControlPhysicalReadback).lifecycle))
    && Number.isSafeInteger((value as SourceControlPhysicalReadback).generation)
    && (value as SourceControlPhysicalReadback).generation >= 0;
}

function initial(physical: SourceIsolationPhysicalPort): Readonly<SourceIsolationState> {
  const spot = physical.read('public-spot-source');
  const usdm = physical.read('public-usdm-source');
  if (!validPhysical(spot) || !validPhysical(usdm)) throw new TypeError('source physical readback is invalid');
  return Object.freeze({
    schema: 'cosmos.source-isolation.v1' as const,
    revision: 0,
    sources: Object.freeze({
      'public-spot-source': Object.freeze({ sourceRevision: 0, desiredLifecycle: 'LIVE' as const, expectedPhysicalGeneration: spot.generation }),
      'public-usdm-source': Object.freeze({ sourceRevision: 0, desiredLifecycle: 'LIVE' as const, expectedPhysicalGeneration: usdm.generation }),
    }),
    receipts: Object.freeze([]),
  });
}

function validRequest(value: Readonly<SourceIsolationRequest>): boolean {
  return KEY.test(value.idempotencyKey)
    && ISOLATABLE_PUBLIC_SOURCE_IDS.includes(value.sourceId)
    && ['ISOLATE', 'RESTART'].includes(value.action)
    && Number.isSafeInteger(value.expectedSourceRevision) && value.expectedSourceRevision >= 0
    && Number.isSafeInteger(value.requestedAtMs) && value.requestedAtMs >= 0
    && typeof value.reason === 'string' && value.reason.trim() === value.reason && value.reason.length >= 1 && value.reason.length <= 240
    && typeof value.actor?.id === 'string' && value.actor.id.trim().length > 0 && value.actor.id.length <= 160
    && (value.actor.email === null || (typeof value.actor.email === 'string' && value.actor.email.length <= 320))
    && ['loopback', 'cloudflare-access'].includes(value.actor.source);
}

function sourceSnapshot(
  sourceId: IsolatablePublicSourceId,
  state: Readonly<SourceIsolationState>,
  physical: Readonly<SourceControlPhysicalReadback>,
): Readonly<SourceIsolationSnapshot> {
  const source = state.sources[sourceId];
  return Object.freeze({
    sourceId,
    sourceRevision: source.sourceRevision,
    desiredLifecycle: source.desiredLifecycle,
    observedLifecycle: physical.lifecycle,
    lifecycle: physical.lifecycle,
    generation: physical.generation,
  });
}

class SourceIsolationOwner implements SourceIsolationOwnerPort {
  constructor(private readonly options: Readonly<SourceIsolationOwnerOptions>) {}

  private load(): Readonly<{
    persisted: Readonly<SourceIsolationState> | null;
    state: Readonly<SourceIsolationState>;
  }> {
    const persisted = this.options.persistence.load();
    return Object.freeze({ persisted, state: persisted ?? initial(this.options.physical) });
  }

  canApply(sourceId: string, action: string, expectedSourceRevision: number): Readonly<{ ok: boolean; code: string }> {
    if (!ISOLATABLE_PUBLIC_SOURCE_IDS.includes(sourceId as IsolatablePublicSourceId)
      || !['ISOLATE', 'RESTART'].includes(action)
      || !Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0) {
      return Object.freeze({ ok: false, code: 'INVALID_SOURCE_CONTROL_REQUEST' });
    }
    const state = this.load().state;
    const source = state.sources[sourceId as IsolatablePublicSourceId];
    if (source.sourceRevision !== expectedSourceRevision) return Object.freeze({ ok: false, code: 'STALE_SOURCE_REVISION' });
    if (action === 'ISOLATE' && source.desiredLifecycle === 'ISOLATED') return Object.freeze({ ok: false, code: 'SOURCE_ALREADY_ISOLATED' });
    if (action === 'RESTART' && source.desiredLifecycle !== 'ISOLATED') return Object.freeze({ ok: false, code: 'SOURCE_NOT_ISOLATED' });
    return Object.freeze({ ok: true, code: 'SOURCE_CONTROL_ACCEPTED' });
  }

  snapshot(sourceId: IsolatablePublicSourceId): Readonly<SourceIsolationSnapshot> {
    const state = this.load().state;
    const physical = this.options.physical.read(sourceId);
    if (!validPhysical(physical)) throw new TypeError('source physical readback is invalid');
    return sourceSnapshot(sourceId, state, physical);
  }

  readEffect(sourceId: IsolatablePublicSourceId): 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN' {
    try {
      const state = this.load().state;
      const source = state.sources[sourceId];
      const physical = this.options.physical.read(sourceId);
      if (!validPhysical(physical)) return 'UNKNOWN';
      if (source.desiredLifecycle === 'ISOLATED') return physical.lifecycle === 'ISOLATED' ? 'APPLIED' : 'NOT_APPLIED';
      // A process restart resets the physical adapter's in-memory generation.
      // The durable source revision remains the command/CAS authority; exact
      // lifecycle is the restart effect readback across process boundaries.
      return ['LIVE', 'WARMING', 'DEGRADED'].includes(physical.lifecycle) ? 'APPLIED' : 'NOT_APPLIED';
    } catch {
      return 'UNKNOWN';
    }
  }

  async apply(request: Readonly<SourceIsolationRequest>): Promise<SourceIsolationResult> {
    if (!validRequest(request)) return Object.freeze({ ok: false, code: 'INVALID_SOURCE_CONTROL_REQUEST' });
    let loaded: ReturnType<SourceIsolationOwner['load']>;
    try {
      loaded = this.load();
    } catch {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_STATE_UNAVAILABLE' });
    }
    const before = loaded.state;
    const requestDigest = digest(request);
    const replay = before.receipts.find((receipt) => receipt.idempotencyKey === request.idempotencyKey);
    if (replay) {
      if (replay.requestDigest !== requestDigest) return Object.freeze({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
      if (this.readEffect(request.sourceId) !== 'APPLIED') {
        try {
          if (replay.action === 'ISOLATE') this.options.physical.isolate(replay.sourceId);
          else this.options.physical.restart(replay.sourceId);
        } catch {
          return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING', receiptId: replay.receiptId });
        }
      }
      if (this.readEffect(request.sourceId) !== 'APPLIED') {
        return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING', receiptId: replay.receiptId });
      }
      return Object.freeze({
        ok: true,
        status: 'ALREADY_APPLIED',
        receiptId: replay.receiptId,
        snapshot: this.snapshot(request.sourceId),
      });
    }
    let nowMs: number;
    try { nowMs = this.options.clock.nowMs(); } catch {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_CLOCK_INVALID' });
    }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || Math.abs(nowMs - request.requestedAtMs) > 60_000) {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_CLOCK_INVALID' });
    }
    const source = before.sources[request.sourceId];
    if (source.sourceRevision !== request.expectedSourceRevision) {
      return Object.freeze({ ok: false, code: 'STALE_SOURCE_REVISION' });
    }
    if (request.action === 'ISOLATE' && source.desiredLifecycle === 'ISOLATED') {
      return Object.freeze({ ok: false, code: 'SOURCE_ALREADY_ISOLATED' });
    }
    if (request.action === 'RESTART' && source.desiredLifecycle !== 'ISOLATED') {
      return Object.freeze({ ok: false, code: 'SOURCE_NOT_ISOLATED' });
    }
    let physicalBefore: Readonly<SourceControlPhysicalReadback>;
    try { physicalBefore = this.options.physical.read(request.sourceId); } catch {
      return Object.freeze({ ok: false, code: 'SOURCE_LIFECYCLE_READBACK_INVALID' });
    }
    if (!validPhysical(physicalBefore)) return Object.freeze({ ok: false, code: 'SOURCE_LIFECYCLE_READBACK_INVALID' });
    const nextSource: Readonly<SourceState> = Object.freeze({
      sourceRevision: request.expectedSourceRevision + 1,
      desiredLifecycle: request.action === 'ISOLATE' ? 'ISOLATED' as const : 'LIVE' as const,
      expectedPhysicalGeneration: physicalBefore.generation + 1,
    });
    const receipt: Readonly<SourceReceipt> = Object.freeze({
      receiptId: `source-control:${requestDigest}`,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      sourceId: request.sourceId,
      action: request.action,
      actor: Object.freeze({ ...request.actor }),
      reason: request.reason,
      requestedAtMs: request.requestedAtMs,
      sourceRevision: nextSource.sourceRevision,
    });
    const next = Object.freeze({
      schema: 'cosmos.source-isolation.v1' as const,
      revision: before.revision + 1,
      sources: Object.freeze({ ...before.sources, [request.sourceId]: nextSource }),
      receipts: Object.freeze([...before.receipts.slice(-255), receipt]),
    });
    let committed = false;
    try { committed = this.options.persistence.compareAndSet(loaded.persisted, next, receipt); } catch {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_PERSISTENCE_UNAVAILABLE' });
    }
    if (!committed) {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_CAS_CONFLICT' });
    }
    try {
      if (request.action === 'ISOLATE') this.options.physical.isolate(request.sourceId);
      else this.options.physical.restart(request.sourceId);
    } catch {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING', receiptId: receipt.receiptId });
    }
    if (this.readEffect(request.sourceId) !== 'APPLIED') {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING', receiptId: receipt.receiptId });
    }
    return Object.freeze({
      ok: true,
      status: 'APPLIED',
      receiptId: receipt.receiptId,
      snapshot: this.snapshot(request.sourceId),
    });
  }
}

export function createSourceIsolationOwner(options: Readonly<SourceIsolationOwnerOptions>): SourceIsolationOwnerPort {
  if (!options || typeof options.clock?.nowMs !== 'function'
    || typeof options.persistence?.load !== 'function'
    || typeof options.persistence?.compareAndSet !== 'function'
    || typeof options.physical?.read !== 'function'
    || typeof options.physical?.isolate !== 'function'
    || typeof options.physical?.restart !== 'function') {
    throw new TypeError('source isolation owner requires clock, Ledger CAS, and physical source ports');
  }
  return Object.freeze(new SourceIsolationOwner(Object.freeze({ ...options })));
}
