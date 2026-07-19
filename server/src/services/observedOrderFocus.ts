import type { Ledger } from '../ledger.js';
import type { Clock } from '../engine/v0/types.js';
import {
  inspectObservedOrderFocusSnapshot,
  observedOrderFocusFingerprint,
  type ObservedOrderFocusApplyResult,
  type ObservedOrderFocusApplyStatus,
  type ObservedOrderFocusSnapshot,
} from '../engine/volume/observedOrderFocus.js';

export const OBSERVED_ORDER_FOCUS_CONFIG_KEY = 'volume.observed-order-focus.v1';
const CHECKPOINT_SCHEMA = 'cosmos.volume-observed-order-focus.v1';
const AUDIT_SCHEMA = 'cosmos.volume-observed-order-focus.audit.v1';
const AUDIT_KIND = 'volume.observed_order_focus';

function requireUtcMillis(value: unknown, path: string): number {
  if (typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
      || Object.is(value, -0)
      || value > 4_102_444_800_000) {
    throw new TypeError(`${path} must be valid UTC milliseconds`);
  }
  return value;
}

export interface DurableObservedOrderFocusCheckpoint {
  readonly schema: typeof CHECKPOINT_SCHEMA;
  readonly revision: number;
  readonly fingerprint: string;
  readonly snapshot: Readonly<ObservedOrderFocusSnapshot>;
}

export type DurableObservedOrderFocusRead = Readonly<
  | { state: 'EMPTY'; raw: null; checkpoint: null }
  | { state: 'AVAILABLE'; raw: string; checkpoint: Readonly<DurableObservedOrderFocusCheckpoint> }
  | { state: 'CORRUPT'; raw: string; checkpoint: null }
  | { state: 'UNAVAILABLE'; raw: null; checkpoint: null }
>;

export type DurableObservedOrderFocusCommit = Readonly<
  | { state: 'COMMITTED'; checkpoint: Readonly<DurableObservedOrderFocusCheckpoint> }
  | { state: 'CONFLICT' | 'UNAVAILABLE'; checkpoint: null }
>;

export interface DurableObservedOrderFocusPersistence {
  readonly read: () => DurableObservedOrderFocusRead;
  readonly compareAndSet: (
    expected: Readonly<Extract<DurableObservedOrderFocusRead, { state: 'EMPTY' | 'AVAILABLE' }>>,
    snapshot: Readonly<ObservedOrderFocusSnapshot>,
    persistedAtMs: number,
  ) => DurableObservedOrderFocusCommit;
}

export interface ObservedOrderFocusStrategyPort {
  readonly applyObservedOrderFocus: (snapshot: unknown) => Readonly<ObservedOrderFocusApplyResult>;
  readonly restoreObservedOrderFocus: (snapshot: unknown) => Readonly<ObservedOrderFocusApplyResult>;
  readonly observedOrderFocusReadback: (
    status: ObservedOrderFocusApplyStatus,
    applied: boolean,
    reasonCodes: readonly string[],
  ) => Readonly<ObservedOrderFocusApplyResult>;
}

export type DurableObservedOrderFocusRestoreResult = Readonly<
  | { state: 'EMPTY'; application: null }
  | {
      state: 'RESTORED' | 'EXPIRED';
      application: Readonly<ObservedOrderFocusApplyResult>;
    }
  | {
      state: 'UNAVAILABLE' | 'CORRUPT' | 'CONFLICT';
      application: Readonly<ObservedOrderFocusApplyResult>;
    }
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareText);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function checkpoint(
  revision: number,
  snapshot: Readonly<ObservedOrderFocusSnapshot>,
): Readonly<DurableObservedOrderFocusCheckpoint> {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    revision,
    fingerprint: observedOrderFocusFingerprint(snapshot),
    snapshot: Object.freeze({
      sourceOwner: snapshot.sourceOwner,
      sourceId: snapshot.sourceId,
      authority: snapshot.authority,
      state: snapshot.state,
      observedAtMs: snapshot.observedAtMs,
      validUntilMs: snapshot.validUntilMs,
      openSymbols: snapshot.openSymbols === null ? null : Object.freeze([...snapshot.openSymbols]),
      reasonCodes: Object.freeze([...snapshot.reasonCodes]),
    }),
  });
}

function encode(value: Readonly<DurableObservedOrderFocusCheckpoint>): string {
  return JSON.stringify({
    schema: value.schema,
    revision: value.revision,
    fingerprint: value.fingerprint,
    snapshot: value.snapshot,
  });
}

function decode(raw: string): Readonly<DurableObservedOrderFocusCheckpoint> | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, ['fingerprint', 'revision', 'schema', 'snapshot'])
      || row.schema !== CHECKPOINT_SCHEMA
      || !Number.isSafeInteger(row.revision)
      || Number(row.revision) < 1
      || typeof row.fingerprint !== 'string'
      || !/^oof_[a-f0-9]{64}$/.test(row.fingerprint)) return null;
  const inspected = inspectObservedOrderFocusSnapshot(row.snapshot);
  if (inspected.snapshot === null
      || inspected.snapshot.state !== 'AVAILABLE'
      || inspected.snapshot.observedAtMs === null
      || inspected.snapshot.validUntilMs === null
      || inspected.snapshot.openSymbols === null) return null;
  const normalized = checkpoint(Number(row.revision), inspected.snapshot);
  if (normalized.fingerprint !== row.fingerprint || encode(normalized) !== raw) return null;
  return normalized;
}

export function createObservedOrderFocusPersistence(
  ledger: Pick<Ledger, 'getConfigValue' | 'compareAndSetConfigValueAndLogEvents'>,
): Readonly<DurableObservedOrderFocusPersistence> {
  if (!ledger || typeof ledger.getConfigValue !== 'function'
      || typeof ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
    throw new TypeError('observed-order focus persistence requires the canonical Ledger CAS owner');
  }
  return Object.freeze({
    read(): DurableObservedOrderFocusRead {
      let raw: string | null;
      try { raw = ledger.getConfigValue(OBSERVED_ORDER_FOCUS_CONFIG_KEY); } catch {
        return Object.freeze({ state: 'UNAVAILABLE', raw: null, checkpoint: null });
      }
      if (raw === null) return Object.freeze({ state: 'EMPTY', raw: null, checkpoint: null });
      const parsed = decode(raw);
      return parsed === null
        ? Object.freeze({ state: 'CORRUPT', raw, checkpoint: null })
        : Object.freeze({ state: 'AVAILABLE', raw, checkpoint: parsed });
    },
    compareAndSet(
      expected: Readonly<Extract<DurableObservedOrderFocusRead, { state: 'EMPTY' | 'AVAILABLE' }>>,
      snapshot: Readonly<ObservedOrderFocusSnapshot>,
      persistedAtMs: number,
    ): DurableObservedOrderFocusCommit {
      if (!Number.isSafeInteger(persistedAtMs)
          || persistedAtMs < 0
          || Object.is(persistedAtMs, -0)
          || persistedAtMs > 4_102_444_800_000) {
        return Object.freeze({ state: 'UNAVAILABLE', checkpoint: null });
      }
      const inspected = inspectObservedOrderFocusSnapshot(snapshot);
      if (inspected.snapshot === null
          || inspected.snapshot.state !== 'AVAILABLE'
          || inspected.snapshot.observedAtMs === null
          || inspected.snapshot.validUntilMs === null
          || inspected.snapshot.openSymbols === null) {
        return Object.freeze({ state: 'UNAVAILABLE', checkpoint: null });
      }
      const priorRevision = expected.state === 'AVAILABLE' ? expected.checkpoint.revision : 0;
      if (priorRevision >= Number.MAX_SAFE_INTEGER) {
        return Object.freeze({ state: 'CONFLICT', checkpoint: null });
      }
      const next = checkpoint(priorRevision + 1, inspected.snapshot);
      try {
        const result = ledger.compareAndSetConfigValueAndLogEvents(
          OBSERVED_ORDER_FOCUS_CONFIG_KEY,
          expected.raw,
          encode(next),
          [Object.freeze({
            kind: AUDIT_KIND,
            symbol: null,
            data: Object.freeze({
              schema: AUDIT_SCHEMA,
              revision: next.revision,
              fingerprint: next.fingerprint,
              sourceId: next.snapshot.sourceId,
              observedAtMs: next.snapshot.observedAtMs,
              validUntilMs: next.snapshot.validUntilMs,
              openSymbolCount: next.snapshot.openSymbols?.length ?? 0,
              knownEmpty: next.snapshot.openSymbols?.length === 0,
              persistedAtMs,
            }),
          })],
        );
        return result.committed
          ? Object.freeze({ state: 'COMMITTED', checkpoint: next })
          : Object.freeze({ state: 'CONFLICT', checkpoint: null });
      } catch {
        return Object.freeze({ state: 'UNAVAILABLE', checkpoint: null });
      }
    },
  });
}

/**
 * Durability-first coordinator. Every newer complete cut reaches the sole
 * Ledger CAS before Volume memory; unknown truth never advances or clears the
 * durable high-water mark.
 */
export class DurableObservedOrderFocusCoordinator {
  constructor(
    private readonly clock: Clock,
    private readonly persistence: Readonly<DurableObservedOrderFocusPersistence>,
    private readonly strategy: Readonly<ObservedOrderFocusStrategyPort>,
  ) {}

  /** Restore the durable high-water mark without requiring a fresh owner cut. */
  restore(): DurableObservedOrderFocusRestoreResult {
    requireUtcMillis(this.clock.now(), 'observed-order focus coordinator clock');
    const durable = this.persistence.read();
    if (durable.state === 'EMPTY') return Object.freeze({ state: 'EMPTY', application: null });
    if (durable.state === 'UNAVAILABLE') {
      return Object.freeze({
        state: 'UNAVAILABLE',
        application: this.strategy.observedOrderFocusReadback(
          'REJECTED_PERSISTENCE_UNAVAILABLE', false, ['OBSERVED_ORDER_FOCUS_PERSISTENCE_UNAVAILABLE'],
        ),
      });
    }
    if (durable.state === 'CORRUPT') {
      return Object.freeze({
        state: 'CORRUPT',
        application: this.strategy.observedOrderFocusReadback(
          'REJECTED_PERSISTENCE_CORRUPT', false, ['OBSERVED_ORDER_FOCUS_PERSISTENCE_CORRUPT'],
        ),
      });
    }
    const application = this.strategy.restoreObservedOrderFocus(durable.checkpoint.snapshot);
    if (application.status === 'REJECTED_EXPIRED') {
      return Object.freeze({ state: 'EXPIRED', application });
    }
    if (application.status !== 'APPLIED' && application.status !== 'IDEMPOTENT') {
      return Object.freeze({
        state: 'CONFLICT',
        application: this.strategy.observedOrderFocusReadback(
          'REJECTED_PERSISTENCE_CONFLICT',
          false,
          ['OBSERVED_ORDER_FOCUS_MEMORY_DURABLE_CONFLICT'],
        ),
      });
    }
    return Object.freeze({ state: 'RESTORED', application });
  }

  apply(snapshot: unknown): Readonly<ObservedOrderFocusApplyResult> {
    const now = requireUtcMillis(this.clock.now(), 'observed-order focus coordinator clock');
    const inspected = inspectObservedOrderFocusSnapshot(snapshot);
    if (inspected.snapshot === null) return this.strategy.applyObservedOrderFocus(snapshot);
    const safe = inspected.snapshot;
    const durable = this.persistence.read();
    if (durable.state === 'UNAVAILABLE') {
      return this.strategy.observedOrderFocusReadback(
        'REJECTED_PERSISTENCE_UNAVAILABLE', false, ['OBSERVED_ORDER_FOCUS_PERSISTENCE_UNAVAILABLE'],
      );
    }
    if (durable.state === 'CORRUPT') {
      return this.strategy.observedOrderFocusReadback(
        'REJECTED_PERSISTENCE_CORRUPT', false, ['OBSERVED_ORDER_FOCUS_PERSISTENCE_CORRUPT'],
      );
    }

    if (durable.state === 'AVAILABLE') {
      const restored = this.strategy.restoreObservedOrderFocus(durable.checkpoint.snapshot);
      if (restored.status !== 'APPLIED'
          && restored.status !== 'IDEMPOTENT'
          && restored.status !== 'REJECTED_EXPIRED') {
        return this.strategy.observedOrderFocusReadback(
          'REJECTED_PERSISTENCE_CONFLICT', false, ['OBSERVED_ORDER_FOCUS_MEMORY_DURABLE_CONFLICT'],
        );
      }
    }

    if (safe.state === 'UNAVAILABLE') return this.strategy.applyObservedOrderFocus(safe);
    if (durable.state === 'AVAILABLE') {
      const prior = durable.checkpoint.snapshot;
      if ((safe.observedAtMs as number) < (prior.observedAtMs as number)) {
        return this.strategy.observedOrderFocusReadback(
          'REJECTED_NON_MONOTONIC', false, ['OBSERVED_ORDER_FOCUS_CUT_NON_MONOTONIC'],
        );
      }
      if (safe.observedAtMs === prior.observedAtMs) {
        if (observedOrderFocusFingerprint(safe) !== durable.checkpoint.fingerprint) {
          return this.strategy.observedOrderFocusReadback(
            'REJECTED_CONFLICT', false, ['OBSERVED_ORDER_FOCUS_CUT_CONFLICT'],
          );
        }
        return this.strategy.applyObservedOrderFocus(safe);
      }
    }

    if (safe.observedAtMs === null || safe.validUntilMs === null || safe.openSymbols === null
        || safe.observedAtMs > now + 5_000 || now > safe.validUntilMs) {
      return this.strategy.applyObservedOrderFocus(safe);
    }

    const persisted = this.persistence.compareAndSet(durable, safe, now);
    if (persisted.state !== 'COMMITTED') {
      if (persisted.state === 'CONFLICT') {
        const winner = this.persistence.read();
        if (winner.state === 'AVAILABLE') {
          this.strategy.restoreObservedOrderFocus(winner.checkpoint.snapshot);
        }
      }
      return this.strategy.observedOrderFocusReadback(
        persisted.state === 'CONFLICT'
          ? 'REJECTED_PERSISTENCE_CONFLICT'
          : 'REJECTED_PERSISTENCE_UNAVAILABLE',
        false,
        [persisted.state === 'CONFLICT'
          ? 'OBSERVED_ORDER_FOCUS_PERSISTENCE_CONFLICT'
          : 'OBSERVED_ORDER_FOCUS_PERSISTENCE_UNAVAILABLE'],
      );
    }
    return this.strategy.applyObservedOrderFocus(safe);
  }
}
