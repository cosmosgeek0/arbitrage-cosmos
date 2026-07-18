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
  readonly effectState: 'PENDING' | 'APPLIED';
  readonly before: Readonly<SourceIsolationSnapshot>;
  readonly after: Readonly<SourceIsolationSnapshot> | null;
  readonly completedAtMs: number | null;
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

export type SourceIsolationResultReadback =
  | Readonly<{ state: 'NOT_FOUND'; receipt: null; snapshot: null; failureCode: null }>
  | Readonly<{
      state: 'PENDING' | 'TERMINAL';
      receipt: Readonly<SourceReceipt>;
      snapshot: Readonly<SourceIsolationSnapshot>;
      failureCode: null;
    }>
  | Readonly<{ state: 'FAIL_CLOSED'; receipt: null; snapshot: null; failureCode: string }>;

export interface SourceIsolationOwnerPort {
  canApply(sourceId: string, action: string, expectedSourceRevision: number): Readonly<{ ok: boolean; code: string }>;
  apply(request: Readonly<SourceIsolationRequest>): Promise<SourceIsolationResult>;
  snapshot(sourceId: IsolatablePublicSourceId): Readonly<SourceIsolationSnapshot>;
  readEffect(sourceId: IsolatablePublicSourceId): 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
  pendingAction(sourceId: IsolatablePublicSourceId): SourceIsolationAction | null;
  readResult(idempotencyKey: string): Readonly<SourceIsolationResultReadback>;
}

export interface SourceIsolationOwnerOptions {
  readonly clock: { nowMs(): number };
  readonly persistence: SourceIsolationPersistencePort;
  readonly physical: SourceIsolationPhysicalPort;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const RECEIPT_ID = /^source-control:sha256:[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validSnapshot(value: unknown, sourceId?: IsolatablePublicSourceId): value is Readonly<SourceIsolationSnapshot> {
  if (!record(value) || !validPhysical(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return (row.sourceId === 'public-spot-source' || row.sourceId === 'public-usdm-source')
    && (sourceId === undefined || row.sourceId === sourceId)
    && Number.isSafeInteger(row.sourceRevision) && Number(row.sourceRevision) >= 0
    && (row.desiredLifecycle === 'LIVE' || row.desiredLifecycle === 'ISOLATED')
    && row.observedLifecycle === row.lifecycle;
}

function validReceipt(value: unknown): value is Readonly<SourceReceipt> {
  if (!record(value)
    || typeof value.receiptId !== 'string' || !RECEIPT_ID.test(value.receiptId)
    || typeof value.idempotencyKey !== 'string' || !KEY.test(value.idempotencyKey)
    || typeof value.requestDigest !== 'string' || !DIGEST.test(value.requestDigest)
    || (value.sourceId !== 'public-spot-source' && value.sourceId !== 'public-usdm-source')
    || (value.action !== 'ISOLATE' && value.action !== 'RESTART')
    || !record(value.actor)
    || typeof value.actor.id !== 'string' || value.actor.id.trim().length === 0 || value.actor.id.length > 160
    || !(value.actor.email === null || (typeof value.actor.email === 'string' && value.actor.email.length <= 320))
    || (value.actor.source !== 'loopback' && value.actor.source !== 'cloudflare-access')
    || typeof value.reason !== 'string' || value.reason.trim() !== value.reason || value.reason.length < 1 || value.reason.length > 240
    || !Number.isSafeInteger(value.requestedAtMs) || Number(value.requestedAtMs) < 0
    || !Number.isSafeInteger(value.sourceRevision) || Number(value.sourceRevision) < 1
    || (value.effectState !== 'PENDING' && value.effectState !== 'APPLIED')
    || !validSnapshot(value.before, value.sourceId)) return false;
  if (value.before.sourceRevision + 1 !== value.sourceRevision) return false;
  if (value.effectState === 'PENDING') return value.after === null && value.completedAtMs === null;
  if (!validSnapshot(value.after, value.sourceId)
    || value.after.sourceRevision !== value.sourceRevision
    || !Number.isSafeInteger(value.completedAtMs)
    || Number(value.completedAtMs) < Number(value.requestedAtMs)) return false;
  return value.action === 'ISOLATE'
    ? value.after.desiredLifecycle === 'ISOLATED' && value.after.observedLifecycle === 'ISOLATED'
    : value.after.desiredLifecycle === 'LIVE'
      && ['LIVE', 'WARMING', 'DEGRADED'].includes(value.after.observedLifecycle);
}

function validState(value: unknown): value is Readonly<SourceIsolationState> {
  if (!record(value)
    || value.schema !== 'cosmos.source-isolation.v1'
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !record(value.sources)
    || !Array.isArray(value.receipts) || value.receipts.length > 256) return false;
  const sources = value.sources as Record<string, unknown>;
  const sourceIds = Object.keys(sources).sort();
  if (sourceIds.length !== ISOLATABLE_PUBLIC_SOURCE_IDS.length
    || sourceIds.some((sourceId, index) => sourceId !== [...ISOLATABLE_PUBLIC_SOURCE_IDS].sort()[index])) return false;
  for (const sourceId of ISOLATABLE_PUBLIC_SOURCE_IDS) {
    const source = sources[sourceId];
    if (!record(source)
      || !Number.isSafeInteger(source.sourceRevision) || Number(source.sourceRevision) < 0
      || (source.desiredLifecycle !== 'LIVE' && source.desiredLifecycle !== 'ISOLATED')
      || !Number.isSafeInteger(source.expectedPhysicalGeneration) || Number(source.expectedPhysicalGeneration) < 0) return false;
  }
  return value.receipts.every((receipt) => validReceipt(receipt)
    && receipt.sourceRevision <= Number((sources[receipt.sourceId] as Record<string, unknown>).sourceRevision));
}

function pendingReceipt(
  state: Readonly<SourceIsolationState>,
  sourceId: IsolatablePublicSourceId,
): Readonly<SourceReceipt> | null {
  return state.receipts.find((receipt) => (
    receipt.sourceId === sourceId
    && receipt.sourceRevision === state.sources[sourceId].sourceRevision
    && receipt.effectState === 'PENDING'
  )) ?? null;
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
    if (persisted !== null && !validState(persisted)) throw new TypeError('source isolation state is invalid');
    return Object.freeze({ persisted, state: persisted ?? initial(this.options.physical) });
  }

  private finalizeReceipt(
    state: Readonly<SourceIsolationState>,
    receipt: Readonly<SourceReceipt>,
    after: Readonly<SourceIsolationSnapshot>,
  ): Readonly<SourceReceipt> | null {
    let nowMs: number;
    try { nowMs = this.options.clock.nowMs(); } catch { return null; }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
    const applied = Object.freeze({
      ...receipt,
      effectState: 'APPLIED' as const,
      after: Object.freeze({ ...after }),
      completedAtMs: Math.max(receipt.requestedAtMs, nowMs),
    });
    const next = Object.freeze({
      ...state,
      revision: state.revision + 1,
      receipts: Object.freeze(state.receipts.map((candidate) => (
        candidate.receiptId === receipt.receiptId ? applied : candidate
      ))),
    });
    try {
      if (this.options.persistence.compareAndSet(state, next, applied)) return applied;
      const raced = this.options.persistence.load();
      if (raced !== null && validState(raced)) {
        const recovered = raced.receipts.find((candidate) => candidate.receiptId === receipt.receiptId);
        return recovered?.effectState === 'APPLIED' ? recovered : null;
      }
    } catch {
      return null;
    }
    return null;
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
    if (pendingReceipt(state, sourceId as IsolatablePublicSourceId)) {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING' });
    }
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

  pendingAction(sourceId: IsolatablePublicSourceId): SourceIsolationAction | null {
    try { return pendingReceipt(this.load().state, sourceId)?.action ?? null; } catch { return null; }
  }

  readResult(idempotencyKey: string): Readonly<SourceIsolationResultReadback> {
    if (!KEY.test(idempotencyKey)) {
      return Object.freeze({ state: 'FAIL_CLOSED', receipt: null, snapshot: null, failureCode: 'SOURCE_RESULT_IDENTITY_INVALID' });
    }
    try {
      const state = this.load().state;
      const receipt = state.receipts.find((candidate) => candidate.idempotencyKey === idempotencyKey);
      if (!receipt) return Object.freeze({ state: 'NOT_FOUND', receipt: null, snapshot: null, failureCode: null });
      if (receipt.effectState === 'PENDING'
        && state.sources[receipt.sourceId].sourceRevision !== receipt.sourceRevision) {
        return Object.freeze({
          state: 'FAIL_CLOSED', receipt: null, snapshot: null,
          failureCode: 'SOURCE_RESULT_SUPERSEDED_PENDING',
        });
      }
      const snapshot = receipt.effectState === 'APPLIED'
        ? receipt.after
        : this.snapshot(receipt.sourceId);
      if (!snapshot) {
        return Object.freeze({ state: 'FAIL_CLOSED', receipt: null, snapshot: null, failureCode: 'SOURCE_RESULT_READBACK_INVALID' });
      }
      return Object.freeze({
        state: receipt.effectState === 'APPLIED' ? 'TERMINAL' : 'PENDING',
        receipt,
        snapshot,
        failureCode: null,
      });
    } catch {
      return Object.freeze({ state: 'FAIL_CLOSED', receipt: null, snapshot: null, failureCode: 'SOURCE_RESULT_STATE_UNAVAILABLE' });
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
      if (replay.effectState === 'APPLIED' && replay.after !== null) {
        return Object.freeze({
          ok: true,
          status: 'ALREADY_APPLIED',
          receiptId: replay.receiptId,
          snapshot: replay.after,
        });
      }
      if (before.sources[replay.sourceId].sourceRevision !== replay.sourceRevision) {
        return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_RESULT_SUPERSEDED_UNKNOWN', receiptId: replay.receiptId });
      }
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
      const replayAfter = this.snapshot(request.sourceId);
      const finalizedReplay = this.finalizeReceipt(before, replay, replayAfter);
      if (!finalizedReplay?.after) {
        return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_RESULT_PENDING', receiptId: replay.receiptId });
      }
      return Object.freeze({
        ok: true,
        status: 'ALREADY_APPLIED',
        receiptId: replay.receiptId,
        snapshot: finalizedReplay.after,
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
    if (pendingReceipt(before, request.sourceId)) {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_EFFECT_PENDING' });
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
      effectState: 'PENDING' as const,
      before: sourceSnapshot(request.sourceId, before, physicalBefore),
      after: null,
      completedAtMs: null,
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
    const after = this.snapshot(request.sourceId);
    const finalized = this.finalizeReceipt(next, receipt, after);
    if (!finalized?.after) {
      return Object.freeze({ ok: false, code: 'SOURCE_CONTROL_RESULT_PENDING', receiptId: receipt.receiptId });
    }
    return Object.freeze({
      ok: true,
      status: 'APPLIED',
      receiptId: receipt.receiptId,
      snapshot: finalized.after,
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
