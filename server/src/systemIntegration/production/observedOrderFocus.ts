import type { NormalizedObservedEvidence } from '../../foundation/reconciliation/index.js';
import type {
  ObservedOrderFocusApplyResult,
  ObservedOrderFocusSnapshot,
} from '../../engine/volume/observedOrderFocus.js';
import type { UtcClock } from '../composition/types.js';
import { projectObservedOrderFocus } from '../adapters/observedOrderFocus.js';

/**
 * Read-only cached Foundation owner. Implementations supply already-normalized
 * evidence for the requested cut; this seam exposes no refresh, credential,
 * signed request, or private exchange transport capability.
 */
export interface ProductionObservedOrderFocusEvidenceOwner {
  readonly readNormalizedObservedEvidence: (
    evaluatedAtMs: number,
  ) => Readonly<NormalizedObservedEvidence> | null;
}

export interface ProductionObservedOrderFocusRuntimePort {
  readonly applyObservedOrderFocus: (
    snapshot: Readonly<ObservedOrderFocusSnapshot>,
  ) => Readonly<ObservedOrderFocusApplyResult>;
}

export type ProductionObservedOrderFocusResult = Readonly<
  | {
      state: 'NOT_CONFIGURED';
      reasonCodes: readonly ['OBSERVED_ORDER_FOCUS_EVIDENCE_OWNER_NOT_CONFIGURED'];
      snapshot: null;
      application: null;
    }
  | {
      state: 'EVIDENCE_UNAVAILABLE' | 'INPUT_REJECTED';
      reasonCodes: readonly string[];
      snapshot: null;
      application: null;
    }
  | {
      state: 'APPLIED' | 'RETAINED' | 'APPLY_REJECTED';
      reasonCodes: readonly string[];
      snapshot: Readonly<ObservedOrderFocusSnapshot>;
      application: Readonly<ObservedOrderFocusApplyResult>;
    }
>;

export interface ProductionObservedOrderFocusPort {
  readonly readAndApplyCachedEvidence: () => ProductionObservedOrderFocusResult;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reasons(...values: string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function failed(
  state: 'EVIDENCE_UNAVAILABLE' | 'INPUT_REJECTED',
  ...reasonCodes: string[]
): ProductionObservedOrderFocusResult {
  return Object.freeze({
    state,
    reasonCodes: reasons(...reasonCodes),
    snapshot: null,
    application: null,
  });
}

/**
 * The only production Foundation-to-Volume callsite. Projection is lossy and
 * runtime admission is durability-first; no private client is constructed or
 * reachable here.
 */
export function createProductionObservedOrderFocusPort(input: Readonly<{
  clock: UtcClock;
  runtime: Readonly<ProductionObservedOrderFocusRuntimePort>;
  owner: Readonly<ProductionObservedOrderFocusEvidenceOwner> | null;
}>): Readonly<ProductionObservedOrderFocusPort> {
  return Object.freeze({
    readAndApplyCachedEvidence(): ProductionObservedOrderFocusResult {
      if (input.owner === null) {
        return Object.freeze({
          state: 'NOT_CONFIGURED',
          reasonCodes: Object.freeze(['OBSERVED_ORDER_FOCUS_EVIDENCE_OWNER_NOT_CONFIGURED'] as const),
          snapshot: null,
          application: null,
        });
      }

      const nowMs = input.clock.nowMs();
      if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 4_102_444_800_000) {
        throw new TypeError('clock.nowMs returned invalid UTC ms');
      }
      let evidence: Readonly<NormalizedObservedEvidence> | null;
      try {
        evidence = input.owner.readNormalizedObservedEvidence(nowMs);
      } catch {
        return failed('EVIDENCE_UNAVAILABLE', 'OBSERVED_ORDER_FOCUS_EVIDENCE_READ_FAILED');
      }
      if (evidence === null) {
        return failed('EVIDENCE_UNAVAILABLE', 'OBSERVED_ORDER_FOCUS_EVIDENCE_UNAVAILABLE');
      }

      let snapshot: Readonly<ObservedOrderFocusSnapshot>;
      try {
        if (evidence.evaluatedAtMs !== nowMs) {
          return failed('INPUT_REJECTED', 'OBSERVED_ORDER_FOCUS_EVIDENCE_CUT_MISMATCH');
        }
        snapshot = projectObservedOrderFocus(evidence);
      } catch {
        return failed('INPUT_REJECTED', 'OBSERVED_ORDER_FOCUS_PROJECTION_FAILED');
      }

      let application: Readonly<ObservedOrderFocusApplyResult>;
      try {
        application = input.runtime.applyObservedOrderFocus(snapshot);
      } catch {
        return failed('INPUT_REJECTED', 'OBSERVED_ORDER_FOCUS_APPLICATION_FAILED');
      }
      const state = application.applied || application.status === 'IDEMPOTENT'
        ? 'APPLIED'
        : application.status === 'UNAVAILABLE_RETAINED' || application.status === 'UNAVAILABLE_EXPIRED'
          ? 'RETAINED'
          : 'APPLY_REJECTED';
      return Object.freeze({
        state,
        reasonCodes: reasons(...application.reasonCodes),
        snapshot,
        application,
      });
    },
  });
}
